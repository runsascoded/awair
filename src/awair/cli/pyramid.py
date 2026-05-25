"""`awair pyramid` — build pyrmts pyramid shards from awair raw data."""

from __future__ import annotations

from pathlib import Path
from sys import stderr
from typing import Optional

import pandas as pd
from click import option

from ..pyramid.builder import (
    aggregate_raw,
    coarsen,
    format_key,
    parse_period,
    repo_pyramid_config,
    row_group_size_for_bin,
    shards_overlapping,
)
from ..pyramid.config import PyramidConfig, Tier
from ..pyramid.io import head, read_parquet, write_parquet
from .base import awair
from .common_opts import device_id_opt
from .config import resolve_device_by_name_or_id

DEFAULT_OUT_BASE = 'tmp'


def err(*args, **kw):
    print(*args, file=stderr, **kw)


@awair.group
def pyramid():
    """Build/serve pyrmts pyramid shards."""
    pass


@pyramid.command
@option('-c', '--config', 'config_path', type=str, default=None, help="Pyramid YAML config (default: ./pyramid.yml at repo root)")
@option('-f', '--from-tier', 'from_tier_name', type=str, default=None, help='Source tier for coarsening (default: previous tier in config)')
@option('-n', '--dry-run', is_flag=True, help="Print what would be built without writing")
@option('-o', '--out-base', type=str, default=DEFAULT_OUT_BASE, help=f'Output base (local dir or s3://… / r2://… URL). Default: {DEFAULT_OUT_BASE}')
@option('-p', '--period', type=str, required=True, help="Period descriptor (e.g. '2026-05' for 1mo, '2026' for 1y)")
@option('-s', '--from-s3', 'from_s3', type=str, default=None, help='Explicit S3 raw input (raw tier only; default: s3://380nwk/awair-{id}/{period}.parquet)')
@option('-t', '--tier', 'tier_name', type=str, required=True, help='Target tier name (raw, h1, d1, mo1)')
@device_id_opt
def build(
    device_id: Optional[str],
    tier_name: str,
    period: str,
    from_s3: Optional[str],
    out_base: str,
    from_tier_name: Optional[str],
    dry_run: bool,
    config_path: Optional[str],
):
    """Build one (device, tier, period) shard.

    For tier=raw: aggregates an existing S3 monthly raw file into the
    configured bin (default 1min).

    For coarser tiers: reads the previous tier's shard(s) covering the same
    period and re-applies the sum monoid at the target bin. Source shards
    are looked up under the same out-base as where this command writes.
    """
    config = repo_pyramid_config() if config_path is None else _load_external(config_path)

    if device_id is None:
        raise SystemExit("--device-id is required (numeric id or name pattern like 'gym')")
    _, dev_id_int = resolve_device_by_name_or_id(device_id)

    target = config.tier(tier_name)

    start, end = parse_period(period, target.shard)
    out_key = format_key(config.key_template, device_id=dev_id_int, tier=tier_name, period=period)
    out_path = _join_base(out_base, out_key)

    err(f'[{dev_id_int}] {tier_name} {period}: target shard {start.isoformat()} → {end.isoformat()}')
    err(f'  Output: {out_path}')

    if tier_name == 'raw':
        shard = _build_raw(config, target, dev_id_int, period, from_s3)
    else:
        source = (
            config.tier(from_tier_name)
            if from_tier_name is not None
            else config.previous_tier(tier_name)
        )
        shard = _build_coarsened(config, target, source, dev_id_int, period, start, end, out_base)

    err(f'  Rows: {len(shard):,}')

    if dry_run:
        err('  --dry-run: not writing')
        return

    _ensure_parent(out_path)
    write_parquet(shard, out_path, row_group_size=row_group_size_for_bin(target.bin))
    err(f'  Wrote: {out_path}')


def _build_raw(
    config: PyramidConfig,
    target: Tier,
    device_id: int,
    period: str,
    from_s3: Optional[str],
) -> pd.DataFrame:
    if target.shard != '1mo':
        # The existing awair raw layout in S3 is monthly. If you want a non-monthly
        # raw target, supply --from-s3 explicitly.
        if from_s3 is None:
            raise SystemExit(
                f"tier=raw with shard={target.shard!r} needs --from-s3 (only shard='1mo' has a default S3 source)"
            )
    src = from_s3 if from_s3 is not None else f's3://380nwk/awair-{device_id}/{period}.parquet'
    err(f'  Reading raw: {src}')
    raw = read_parquet(src)
    return aggregate_raw(raw, device_id=device_id, tier=target, metrics=config.metrics)


def _build_coarsened(
    config: PyramidConfig,
    target: Tier,
    source: Tier,
    device_id: int,
    period: str,
    start,
    end,
    out_base: str,
) -> pd.DataFrame:
    src_periods = shards_overlapping(start, end, source.shard)
    err(f'  Coarsening from {source.name} ({len(src_periods)} source shard(s))')

    frames: list[pd.DataFrame] = []
    for sp in src_periods:
        src_key = format_key(config.key_template, device_id=device_id, tier=source.name, period=sp)
        src_path = _join_base(out_base, src_key)
        if head(src_path) is None:
            err(f'    SKIP {src_path}: not found')
            continue
        err(f'    Reading: {src_path}')
        frames.append(read_parquet(src_path))

    if not frames:
        err('  No source shards found; emitting empty target')
        return aggregate_raw(pd.DataFrame(), device_id=device_id, tier=target, metrics=config.metrics)

    combined = pd.concat(frames, ignore_index=True)
    return coarsen(combined, dst_tier=target, metrics=config.metrics)


def _load_external(path: str) -> PyramidConfig:
    from ..pyramid.config import load_config
    return load_config(path)


def _join_base(base: str, key: str) -> str:
    """Join a base location and a relative key. Supports s3://, r2://, and local paths."""
    if '://' in base:
        return base.rstrip('/') + '/' + key
    return str(Path(base) / key)


def _ensure_parent(path: str) -> None:
    if '://' in path:
        return  # remote backends handle nesting themselves
    Path(path).parent.mkdir(parents=True, exist_ok=True)


@pyramid.command
@option('-c', '--config', 'config_path', type=str, default=None, help="Pyramid YAML config (default: ./pyramid.yml at repo root)")
@option('-F', '--force', is_flag=True, help="Rebuild even if target shard already exists")
@option('-i', '--device-id', 'device_filter', type=str, default=None, help="Single device id or name pattern (default: all active devices)")
@option('-n', '--dry-run', is_flag=True, help="Plan without building")
@option('-o', '--out-base', type=str, default='r2://awair', help="Output base (default: r2://awair)")
@option('-t', '--tier', 'tier_filter', type=str, default=None, help="Single tier name (default: all tiers in config)")
def backfill(
    device_filter: Optional[str],
    tier_filter: Optional[str],
    out_base: str,
    force: bool,
    dry_run: bool,
    config_path: Optional[str],
):
    """Backfill all (device × tier × period) shards.

    Discovers source raw months from S3 (`s3://380nwk/awair-{id}/`), then
    iterates each device × each tier × each covering period. Existing R2
    shards are skipped unless `--force`.
    """
    config = repo_pyramid_config() if config_path is None else _load_external(config_path)
    devices = _resolve_devices(device_filter)
    tiers = _select_tiers(config, tier_filter)
    err(f'Backfill: {len(devices)} device(s), {len(tiers)} tier(s) → {out_base}')

    total_built = 0
    total_skipped = 0
    total_failed = 0

    for dev_name, dev_id in devices:
        months = _list_s3_months(dev_id)
        years = sorted({m.split('-')[0] for m in months})
        err(f'\n[{dev_id} {dev_name}] {len(months)} month(s) of raw, {len(years)} year(s)')

        for tier in tiers:
            periods = months if tier.shard == '1mo' else years
            for period in periods:
                out_key = format_key(config.key_template, device_id=dev_id, tier=tier.name, period=period)
                out_path = _join_base(out_base, out_key)

                if not force and head(out_path) is not None:
                    err(f'  SKIP {tier.name} {period}: already exists')
                    total_skipped += 1
                    continue

                err(f'  BUILD {tier.name} {period} → {out_path}')
                if dry_run:
                    continue

                try:
                    start, end = parse_period(period, tier.shard)
                    if tier.name == 'raw':
                        shard = _build_raw(config, tier, dev_id, period, from_s3=None)
                    else:
                        source = config.previous_tier(tier.name)
                        shard = _build_coarsened(config, tier, source, dev_id, period, start, end, out_base)
                    _ensure_parent(out_path)
                    write_parquet(shard, out_path, row_group_size=row_group_size_for_bin(tier.bin))
                    err(f'    Wrote {len(shard):,} rows')
                    total_built += 1
                except Exception as e:
                    err(f'    FAILED: {e}')
                    total_failed += 1

    err(f'\nDone: built={total_built} skipped={total_skipped} failed={total_failed}')
    if total_failed > 0:
        raise SystemExit(1)


def _resolve_devices(filter_: Optional[str]) -> list[tuple[str, int]]:
    """Return [(name, device_id), ...] for the filter (or all active devices)."""
    from .config import get_devices
    devices = get_devices()
    active = [d for d in devices if d.get('active') is not False]
    if filter_ is not None:
        name, dev_id = resolve_device_by_name_or_id(filter_)
        return [(name, dev_id)]
    return [(d['name'], int(d['deviceId'])) for d in active]


def _select_tiers(config: PyramidConfig, name: Optional[str]) -> list[Tier]:
    if name is None:
        return list(config.tiers)
    return [config.tier(name)]


def _list_s3_months(device_id: int) -> list[str]:
    """List 'YYYY-MM' strings of raw monthly files for `device_id` in s3://380nwk."""
    import boto3
    s3 = boto3.client('s3')
    prefix = f'awair-{device_id}/'
    resp = s3.list_objects_v2(Bucket='380nwk', Prefix=prefix)
    months: list[str] = []
    for obj in resp.get('Contents', []):
        key = obj['Key']
        if not key.endswith('.parquet') or '.bak' in key:
            continue
        basename = key.removeprefix(prefix).removesuffix('.parquet')
        if len(basename) == 7 and basename[4] == '-':
            months.append(basename)
    return sorted(months)
