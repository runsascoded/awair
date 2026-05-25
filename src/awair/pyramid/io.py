"""Parquet I/O for the pyramid builder. Handles local fs, `s3://`, and `r2://` URLs.

For `r2://`, reads `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_ENDPOINT_URL` from the environment to construct an S3-compatible boto3
client. Falls back to a clear error if any of those are unset.
"""

from __future__ import annotations

import os
from functools import lru_cache
from io import BytesIO
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client
else:
    S3Client = object


R2_REQUIRED_VARS = ('R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT_URL')


def read_parquet(url: str) -> pd.DataFrame:
    if url.startswith('r2://'):
        bucket, key = _split_r2(url)
        buf = BytesIO()
        _r2_client().download_fileobj(bucket, key, buf)
        buf.seek(0)
        return pd.read_parquet(buf)
    return pd.read_parquet(url)


def write_parquet(df: pd.DataFrame, url: str, row_group_size: int | None = None) -> None:
    """Write a DataFrame to parquet. Pass `row_group_size` to control RG count.

    pyrmts' row-group filtering (in `fetchShardData`) prunes RGs whose
    `binCol` min/max stats miss the query range, so smaller RGs = finer
    pruning. For typical chart queries on awair raw shards, ~1 day of data
    per RG is a good balance (see `awair.pyramid.builder.row_group_size_for_bin`).
    """
    table = pa.Table.from_pandas(df, preserve_index=False)
    kw: dict = {}
    if row_group_size is not None:
        kw['row_group_size'] = row_group_size
    if url.startswith('r2://'):
        bucket, key = _split_r2(url)
        buf = BytesIO()
        pq.write_table(table, buf, **kw)
        buf.seek(0)
        _r2_client().upload_fileobj(buf, bucket, key)
        return
    pq.write_table(table, url, **kw)


def head(url: str) -> dict | None:
    """Return basic object metadata, or `None` if it doesn't exist."""
    if url.startswith('r2://'):
        import botocore
        bucket, key = _split_r2(url)
        try:
            r = _r2_client().head_object(Bucket=bucket, Key=key)
            return {'size': r['ContentLength'], 'etag': r['ETag'].strip('"')}
        except botocore.exceptions.ClientError as e:
            if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'):
                return None
            raise
    from pathlib import Path
    p = Path(url)
    if not p.exists():
        return None
    return {'size': p.stat().st_size}


def _split_r2(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    if parsed.scheme != 'r2':
        raise ValueError(f'expected r2:// URL, got {url!r}')
    if not parsed.netloc:
        raise ValueError(f'r2:// URL missing bucket: {url!r}')
    if not parsed.path or parsed.path == '/':
        raise ValueError(f'r2:// URL missing key: {url!r}')
    return parsed.netloc, parsed.path.lstrip('/')


@lru_cache(maxsize=1)
def _r2_client() -> S3Client:
    import boto3
    missing = [v for v in R2_REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        raise RuntimeError(
            f'R2 env vars not set: {", ".join(missing)}. '
            f'(direnv should load these from .envrc — try `eval "$(direnv export bash)"`.)'
        )
    return boto3.client(
        's3',
        endpoint_url=os.environ['R2_ENDPOINT_URL'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )
