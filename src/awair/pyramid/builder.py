"""Pure aggregation functions over pandas DataFrames.

Two entry points:

- `aggregate_raw`: takes the awair raw schema (`timestamp` + 6 sensor cols)
  and produces a pyrmts shard for a given tier's bin.
- `coarsen`: takes a pyrmts shard at a finer bin and produces one at a
  coarser bin (re-applies the sum monoid).

Output schema (pyrmts convention for the `sum` monoid):
    ts:                  int64  (UTC ms at bin start)
    device_id:           int32  (only dim for awair)
    {metric}_n:          int32  (count of non-null source readings)
    {metric}_sum:        float64
    {metric}_sumsq:      float64

Rows are sorted `(device_id, ts)` so downstream RG predicate pushdown on
`device_id` is cheap.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import datetime, timedelta, timezone

import pandas as pd

from .config import Metric, PyramidConfig, Tier

# pyrmts bin spec: <count><unit> with unit ∈ {min, h, d, mo, y}.
# Multi-count is supported for the fixed-width units (min/h/d). The mo/y
# units are calendar-aware and only support count=1.
_BIN_RE = re.compile(r'^(\d+)(min|h|d|mo|y)$')
_MS_PER_UNIT = {'min': 60_000, 'h': 3_600_000, 'd': 86_400_000}


def _bin_ms(bin_spec: str) -> int:
    """Fixed-width ms for a `Nmin`/`Nh`/`Nd` bin. Throws for calendar
    (mo/y) — use only for divisibility-checking cascade sources, where
    the source tier's bin is always fixed-width."""
    m = _BIN_RE.match(bin_spec)
    if not m:
        raise ValueError(f'invalid bin: {bin_spec!r}')
    count, unit = int(m.group(1)), m.group(2)
    if unit in _MS_PER_UNIT:
        return count * _MS_PER_UNIT[unit]
    raise ValueError(f'calendar-variable bin {bin_spec!r} has no fixed ms')


def aggregate_raw(
    raw: pd.DataFrame,
    *,
    device_id: int,
    tier: Tier,
    metrics: Iterable[Metric],
) -> pd.DataFrame:
    """Aggregate raw awair rows into one pyrmts shard at `tier.bin`.

    Input columns: `timestamp` (datetime64[ns], naive UTC) + one column per
    metric name. Extra columns are ignored. NaN values are excluded from
    both `_n` (count) and the sums for that metric.
    """
    metrics = list(metrics)
    _require_sum_monoid(metrics)

    if raw.empty:
        return _empty_shard(metrics)

    ts = pd.to_datetime(raw['timestamp']).dt.tz_localize(None)
    bin_ts = _floor_to_bin(ts, tier.bin)

    rows = pd.DataFrame({'bin_ts': bin_ts})
    for m in metrics:
        v = pd.to_numeric(raw[m.name], errors='coerce')
        rows[f'{m.name}_n'] = v.notna().astype('int64')   # int32 cast after groupby
        rows[f'{m.name}_sum'] = v.where(v.notna(), 0.0)
        rows[f'{m.name}_sumsq'] = (v * v).where(v.notna(), 0.0)

    agg_cols = [c for c in rows.columns if c != 'bin_ts']
    grouped = rows.groupby('bin_ts', sort=True, as_index=False)[agg_cols].sum()

    out = pd.DataFrame()
    out['ts'] = (pd.to_datetime(grouped['bin_ts']).astype('int64') // 1_000_000).astype('int64')
    out['device_id'] = pd.Series([device_id] * len(grouped), dtype='int32')
    for m in metrics:
        out[f'{m.name}_n'] = grouped[f'{m.name}_n'].astype('int32')
        out[f'{m.name}_sum'] = grouped[f'{m.name}_sum'].astype('float64')
        out[f'{m.name}_sumsq'] = grouped[f'{m.name}_sumsq'].astype('float64')

    return out.sort_values(['device_id', 'ts']).reset_index(drop=True)


def coarsen(
    src: pd.DataFrame,
    *,
    dst_tier: Tier,
    metrics: Iterable[Metric],
) -> pd.DataFrame:
    """Re-bucket a pyrmts shard from its current bin to `dst_tier.bin`.

    Input is the same schema as the output of `aggregate_raw`. Re-applies
    the sum monoid (column-wise sum of `_n`/`_sum`/`_sumsq` per bin).
    """
    metrics = list(metrics)
    _require_sum_monoid(metrics)

    if src.empty:
        return _empty_shard(metrics)

    bin_ts = _floor_to_bin(pd.to_datetime(src['ts'], unit='ms', utc=True).dt.tz_localize(None), dst_tier.bin)

    state_cols = [c for c in src.columns if c.endswith(('_n', '_sum', '_sumsq'))]
    work = src[state_cols].copy()
    work['device_id'] = src['device_id'].astype('int32')
    work['bin_ts'] = bin_ts

    grouped = work.groupby(['device_id', 'bin_ts'], sort=True, as_index=False)[state_cols].sum()

    out = pd.DataFrame()
    out['ts'] = (pd.to_datetime(grouped['bin_ts']).astype('int64') // 1_000_000).astype('int64')
    out['device_id'] = grouped['device_id'].astype('int32')
    for m in metrics:
        out[f'{m.name}_n'] = grouped[f'{m.name}_n'].astype('int32')
        out[f'{m.name}_sum'] = grouped[f'{m.name}_sum'].astype('float64')
        out[f'{m.name}_sumsq'] = grouped[f'{m.name}_sumsq'].astype('float64')

    return out.sort_values(['device_id', 'ts']).reset_index(drop=True)


def parse_period(period: str, shard: str) -> tuple[datetime, datetime]:
    """Convert a period descriptor + shard span into [start, end) UTC datetimes.

    Examples:
        parse_period('2026-05',     '1mo')  → (2026-05-01, 2026-06-01)
        parse_period('2026-05',     '3mo')  → (2026-04-01, 2026-07-01)   # snap to Q
        parse_period('2026',        '1y')   → (2026-01-01, 2027-01-01)
        parse_period('2026-05-24',  '1d')   → (2026-05-24, 2026-05-25)
        parse_period('2026-05-24',  '32d')  → epoch-aligned 32d span containing 2026-05-24
    """
    if shard == 'all':
        raise NotImplementedError("shard='all' not yet supported")
    m = _BIN_RE.match(shard)
    if not m:
        raise ValueError(f'unknown shard span: {shard!r}')
    count, unit = int(m.group(1)), m.group(2)
    if unit == 'mo':
        if 12 % count != 0:
            raise ValueError(f"shard={shard!r}: 12 must be divisible by {count}")
        try:
            y_str, m_str = period.split('-')
            y, mo = int(y_str), int(m_str)
        except (ValueError, AttributeError):
            raise ValueError(f"shard={shard!r} requires period 'YYYY-MM', got {period!r}")
        # Snap to the containing N-month bucket start (1-indexed months).
        floored_mo = (mo - 1) // count * count
        start = datetime(y, floored_mo + 1, 1, tzinfo=timezone.utc)
        m_end = start.month + count
        y_end = start.year + (m_end - 1) // 12
        m_end = ((m_end - 1) % 12) + 1
        end = datetime(y_end, m_end, 1, tzinfo=timezone.utc)
    elif unit == 'y':
        try:
            y = int(period)
        except ValueError:
            raise ValueError(f"shard={shard!r} requires period 'YYYY', got {period!r}")
        floored_yr = y // count * count
        start = datetime(floored_yr, 1, 1, tzinfo=timezone.utc)
        end = datetime(floored_yr + count, 1, 1, tzinfo=timezone.utc)
    elif unit in ('d', 'h', 'min'):
        # Period label format matches pyrmts' `formatPeriod` — parse just
        # enough of the label to get the containing epoch-aligned span.
        if unit == 'd':
            base = datetime.strptime(period, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        elif unit == 'h':
            base = datetime.strptime(period, '%Y-%m-%dT%H').replace(tzinfo=timezone.utc)
        else:  # min
            base = datetime.strptime(period, '%Y-%m-%dT%H-%M').replace(tzinfo=timezone.utc)
        span_ms = count * _MS_PER_UNIT[unit]
        base_ms = int(base.timestamp() * 1000)
        floored_ms = (base_ms // span_ms) * span_ms
        start = datetime.fromtimestamp(floored_ms / 1000, tz=timezone.utc)
        end = datetime.fromtimestamp((floored_ms + span_ms) / 1000, tz=timezone.utc)
    else:
        raise ValueError(f'unknown shard span: {shard!r}')
    return start, end


def format_key(template: str, *, device_id: int, tier: str, period: str) -> str:
    return template.format(device_id=device_id, tier=tier, period=period)


def filter_period(df: pd.DataFrame, ts_col: str, start: datetime, end: datetime) -> pd.DataFrame:
    """Return rows where `ts_col` falls in [start, end). Used for fine→coarse aggregation across shards."""
    ts = pd.to_datetime(df[ts_col]).dt.tz_localize(None)
    s = pd.Timestamp(start.replace(tzinfo=None))
    e = pd.Timestamp(end.replace(tzinfo=None))
    return df[(ts >= s) & (ts < e)]


def shards_overlapping(start: datetime, end: datetime, shard: str) -> list[str]:
    """Enumerate source-shard period strings whose [from, to) covers [start, end).

    For coarsening: the target shard spans `[start, end)`; the source tier's
    shards may be shorter (e.g. coarsening 1mo shards of `h1` into 1y shards
    of `d1` means we need all 12 monthly source periods).

    Supports `Nmo`, `Ny`, `Nd`, `Nh`, `Nmin` (arbitrary count for fixed-width
    units — matches pyrmts' `parseDuration`). `Nmo` with `12 % N != 0` is
    rejected (pyrmts' floor rule).
    """
    m = _BIN_RE.match(shard)
    if not m:
        raise ValueError(f'invalid shard duration: {shard!r}')
    count, unit = int(m.group(1)), m.group(2)
    periods: list[str] = []
    if unit == 'mo':
        if 12 % count != 0:
            raise ValueError(f'shard={shard!r}: 12 must be divisible by {count} for month spans')
        # Floor to the start of the containing N-month bucket.
        floored_mo = (start.month - 1) // count * count
        cursor = datetime(start.year, floored_mo + 1, 1, tzinfo=timezone.utc)
        while cursor < end:
            # Same format as `1mo` for backward-compat (2026-01 for Q1, etc.).
            periods.append(f'{cursor.year:04d}-{cursor.month:02d}')
            m_end = cursor.month + count
            y_end = cursor.year + (m_end - 1) // 12
            m_end = ((m_end - 1) % 12) + 1
            cursor = datetime(y_end, m_end, 1, tzinfo=timezone.utc)
    elif unit == 'y':
        # Floor to floor(year / N) * N.
        floored_yr = start.year // count * count
        cursor = datetime(floored_yr, 1, 1, tzinfo=timezone.utc)
        while cursor < end:
            periods.append(f'{cursor.year:04d}')
            cursor = datetime(cursor.year + count, 1, 1, tzinfo=timezone.utc)
    elif unit in ('d', 'h', 'min'):
        # Fixed-width epoch-aligned span (matches pyrmts' `floorToSpan` for
        # count>1). Compute span_ms, floor start to it, walk to end.
        span_ms = count * _MS_PER_UNIT[unit]
        start_ms = int(start.replace(tzinfo=timezone.utc).timestamp() * 1000)
        end_ms = int(end.replace(tzinfo=timezone.utc).timestamp() * 1000)
        floored_ms = (start_ms // span_ms) * span_ms
        cursor_ms = floored_ms
        while cursor_ms < end_ms:
            cursor = datetime.fromtimestamp(cursor_ms / 1000, tz=timezone.utc)
            # `formatPeriod` label matches pyrmts: `YYYY-MM-DD` for d, add
            # `THH` for h, `-MM` for min. Cascade + serve read the same key.
            if unit == 'd':
                periods.append(cursor.strftime('%Y-%m-%d'))
            elif unit == 'h':
                periods.append(cursor.strftime('%Y-%m-%dT%H'))
            else:  # min
                periods.append(cursor.strftime('%Y-%m-%dT%H-%M'))
            cursor_ms += span_ms
    else:
        raise ValueError(f'cannot enumerate periods for shard {shard!r}')
    return periods


def row_group_size_for_bin(bin_spec: str) -> int | None:
    """Pick a parquet row-group size targeting ~1 day of data per RG.

    Returns `None` for tiers where one RG covers the whole shard sensibly
    (`7d`, `1mo`, `1y` bins — total rows are already small). pyrmts' RGF
    skips RGs whose `binCol` stats miss the query, so smaller RGs trade
    a bit of metadata overhead for tighter range pruning.
    """
    m = _BIN_RE.match(bin_spec)
    if not m:
        raise ValueError(f'invalid bin spec: {bin_spec!r}')
    count, unit = int(m.group(1)), m.group(2)
    if unit == 'min':
        return max(100, 1440 // count)       # 1min→1440, 5min→288, 30min→48 (clamped 100)
    if unit == 'h':
        return max(100, 24 // count)         # 1h→24 (clamped 100), 3h→100
    if unit == 'd':
        return max(100, 1)                   # always 100; d1/d7 shards are small
    return None                              # mo/y bins: one RG per shard


def _floor_to_bin(ts: pd.Series, bin_spec: str) -> pd.Series:
    """Floor a timestamp series to the bin boundary, matching pyrmts axis semantics.

    Calendar-aligned for `mo`/`y` (only count=1 supported). Epoch-aligned for
    `min`/`h`/`d` (supports count>1, e.g. `5min`, `3h`, `7d`).
    """
    m = _BIN_RE.match(bin_spec)
    if not m:
        raise ValueError(f'invalid bin spec: {bin_spec!r}')
    count, unit = int(m.group(1)), m.group(2)
    if unit == 'mo':
        if count != 1:
            raise ValueError(f'multi-count calendar bins not supported: {bin_spec!r}')
        return ts.dt.to_period('M').dt.start_time
    if unit == 'y':
        if count != 1:
            raise ValueError(f'multi-count calendar bins not supported: {bin_spec!r}')
        return ts.dt.to_period('Y').dt.start_time
    bin_ms = count * _MS_PER_UNIT[unit]
    epoch_ms = ts.astype('int64') // 1_000_000
    floored_ms = (epoch_ms // bin_ms) * bin_ms
    return pd.to_datetime(floored_ms, unit='ms')


def _require_sum_monoid(metrics: list[Metric]) -> None:
    non_sum = [m for m in metrics if m.monoid != 'sum']
    if non_sum:
        names = ', '.join(m.name for m in non_sum)
        raise NotImplementedError(
            f"only 'sum' monoid is implemented for the awair builder; got non-sum metrics: {names}"
        )


def _empty_shard(metrics: list[Metric]) -> pd.DataFrame:
    cols: dict[str, pd.Series] = {
        'ts': pd.Series([], dtype='int64'),
        'device_id': pd.Series([], dtype='int32'),
    }
    for m in metrics:
        cols[f'{m.name}_n'] = pd.Series([], dtype='int32')
        cols[f'{m.name}_sum'] = pd.Series([], dtype='float64')
        cols[f'{m.name}_sumsq'] = pd.Series([], dtype='float64')
    return pd.DataFrame(cols)


def repo_pyramid_config() -> PyramidConfig:
    """Load `pyramid.yml` from the bundled package location (or repo root in tests).

    Source dev: `src/awair/pyramid.yml`. Lambda deployment: `awair/pyramid.yml`
    inside the deployed zip. Both resolve to `Path(__file__).parents[1]`.
    """
    from pathlib import Path

    from .config import load_config
    return load_config(Path(__file__).resolve().parents[1] / 'pyramid.yml')
