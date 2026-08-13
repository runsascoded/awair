"""Append to the pyrmts invalidation journal after a raw write.

Mirrors `pyrmts_engine.invalidation.invalidate` (Python) and pyrmts's JS
`invalidate` — bytes-identical journal doc so cascade (JS,
`~/c/pyrmts/wt/js-shard-validation-and-invalidation/js/packages/pyrmts/src/invalidation.ts`)
reads it back correctly. Reimplemented here rather than adding a
`pyrmts_engine` dep because `pyrmts_engine` pulls polars, blowing the
Lambda zip past its 50 MB upload cap.

Journal shape (list of entries):
    {"start": <epoch_s>, "end": <epoch_s>, "requested_at": <epoch_s>}

Key derivation matches pyrmts (`journal_key(pyramid)`):
    `keyTemplate.split('{')[0] + '_invalidations.json'`

So awair's `pyramid/awair-{device_id}/{tier}/{shard}/{period}.parquet`
template yields the journal at `pyramid/awair-_invalidations.json` —
one journal shared by all devices, same as the Python + JS impls.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from functools import partial

from pyrmts.storage import EtagConflict

from .config import PyramidConfig
from .io import _r2_storage

err = partial(print, file=sys.stderr, flush=True)

JOURNAL_BASENAME = '_invalidations.json'
CAS_ATTEMPTS = 5


def _journal_key(config: PyramidConfig) -> str:
    return config.key_template.split('{')[0] + JOURNAL_BASENAME


def invalidate_interval(
    config: PyramidConfig,
    start: datetime,
    end: datetime,
    *,
    now: datetime | None = None,
) -> int:
    """CAS-append `[start, end)` to the pyramid's invalidation journal;
    the next cascade tick rebuilds every recorded shard whose period
    overlaps and whose `written_at` predates `requested_at`.

    Returns the entry count after the append (for logging).
    """
    if not start < end:
        raise ValueError(f"empty interval [{start.isoformat()}, {end.isoformat()})")
    requested_at = now or datetime.now(timezone.utc)
    entry = {
        'start': start.timestamp(),
        'end': end.timestamp(),
        'requested_at': requested_at.timestamp(),
    }
    bucket = config.storage.get('bucket')
    if not bucket:
        raise ValueError("pyramid storage config missing 'bucket'")
    storage = _r2_storage(bucket)
    key = _journal_key(config)

    for attempt in range(CAS_ATTEMPTS):
        blob, etag = storage.get_with_etag(key)
        entries = json.loads(blob) if blob else []
        entries.append(entry)
        body = (json.dumps(entries) + '\n').encode()
        try:
            storage.put_if_match(key, body, etag)
        except EtagConflict:
            if attempt == CAS_ATTEMPTS - 1:
                raise
            continue
        return len(entries)
    raise AssertionError('unreachable')
