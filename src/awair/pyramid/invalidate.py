"""Thin wrapper: call `pyrmts.invalidation.invalidate` with awair's config.

The write-side of the invalidation journal now lives in `pyrmts` core
(`pyrmts/invalidation.py`, per `pyrmts/specs/streaming-tip-writer.md`) —
zero engine deps, safe to import from Lambda without dragging polars.
This module just constructs the tiny `pyrmts.types.Pyramid` shape
`invalidate` needs (`keyTemplate` + `storage`) from awair's own
`PyramidConfig` and delegates.
"""
from __future__ import annotations

from datetime import datetime

from pyrmts.invalidation import invalidate as _invalidate
from pyrmts.types import Pyramid

from .config import PyramidConfig
from .io import _r2_storage


def _pyrmts_pyramid(config: PyramidConfig) -> Pyramid:
    """Minimal `Pyramid` for `invalidate`: only `keyTemplate` + `storage`
    are read (via `journal_key(pyramid)` and `pyramid.storage.{get,put}_if_match`).
    dims/metrics/tiers are unused and default to empty lists."""
    bucket = config.storage.get('bucket')
    if not bucket:
        raise ValueError("pyramid storage config missing 'bucket'")
    return Pyramid(
        storage=_r2_storage(bucket),
        keyTemplate=config.key_template,
        binCol=config.bin_col,
        dims=[],
        metrics=[],
        tiers=[],
    )


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
    return _invalidate(_pyrmts_pyramid(config), (start, end), now=now)
