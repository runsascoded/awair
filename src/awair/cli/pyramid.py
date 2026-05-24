"""`awair pyramid` — build pyrmts pyramid shards from awair raw data."""

from __future__ import annotations

from pathlib import Path
from sys import stderr
from typing import Optional

import pandas as pd
from click import argument, echo, option

from ..pyramid.builder import (
    aggregate_raw,
    coarsen,
    format_key,
    parse_period,
    repo_pyramid_config,
    shards_overlapping,
    write_shard,
)
from ..pyramid.config import PyramidConfig, Tier
from .base import awair
from .common_opts import device_id_opt
from .config import resolve_device_by_name_or_id

DEFAULT_OUT_BASE = 'tmp/pyramid'

err = lambda *args, **kw: print(*args, file=stderr, **kw)


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
    write_shard(shard, out_path)
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
    raw = pd.read_parquet(src)
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
        err(f'    Reading: {src_path}')
        try:
            frames.append(pd.read_parquet(src_path))
        except (FileNotFoundError, OSError) as e:
            err(f'    SKIP {src_path}: {e}')

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
