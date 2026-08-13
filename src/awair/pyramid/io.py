"""Parquet I/O for the pyramid builder. Handles local fs, `s3://`, and `r2://` URLs.

For `r2://`, delegates to `pyrmts.storage.S3Storage` (which reads
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL` from the
environment, or the AWS defaults for `s3://`). `_r2_client()` is still
exported for callers that need the raw boto3 client (`list_objects_v2`
pagination, etc. — pyrmts's Storage abstraction doesn't wrap that).
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
        data = _r2_storage(bucket).get(key)
        if data is None:
            raise FileNotFoundError(f'r2://{bucket}/{key}')
        return pd.read_parquet(BytesIO(data))
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
        _r2_storage(bucket).put(key, buf.getvalue())
        return
    pq.write_table(table, url, **kw)


def head(url: str) -> dict | None:
    """Return basic object metadata, or `None` if it doesn't exist."""
    if url.startswith('r2://'):
        bucket, key = _split_r2(url)
        return _r2_storage(bucket).head(key)
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


@lru_cache(maxsize=8)
def _r2_storage(bucket: str):
    """Return a `pyrmts.storage.S3Storage` bound to `bucket`. Cached to
    reuse the underlying boto3 client across calls (creating one is
    ~50ms).

    Passes R2 creds explicitly (rather than relying on
    `S3Storage`'s env-fallback) because in Lambda `AWS_ACCESS_KEY_ID`
    is set to the exec role's 20-char AWS key, and `S3Storage`'s chain
    prefers `AWS_*` over `R2_*` — R2 rejects the AWS key with
    `InvalidArgument: Credential access key has length 20, should be
    32`."""
    from pyrmts.storage import S3Storage
    missing = [v for v in R2_REQUIRED_VARS if not os.environ.get(v)]
    if missing:
        raise RuntimeError(
            f'R2 env vars not set: {", ".join(missing)}. '
            f'(direnv should load these from .envrc — try `eval "$(direnv export bash)"`.)'
        )
    return S3Storage(
        bucket=bucket,
        endpoint_url=os.environ['R2_ENDPOINT_URL'],
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )


@lru_cache(maxsize=1)
def _r2_client() -> S3Client:
    """Direct boto3 client — kept for callers that need `list_objects_v2`
    pagination, `copy_object`, or other APIs pyrmts's `Storage` interface
    doesn't expose. Prefer `_r2_storage()` for reads/writes."""
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
