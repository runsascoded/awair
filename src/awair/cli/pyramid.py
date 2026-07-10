"""`awair pyramid` — build pyrmts pyramid shards from awair raw data."""

from __future__ import annotations

import sys
from datetime import datetime
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


@pyramid.command('seed-index')
@option('-c', '--config', 'config_path', type=str, default=None, help="Pyramid YAML config (default: ./pyramid.yml at repo root)")
@option('-n', '--pyramid-name-prefix', 'pyramid_name_prefix', type=str, default='awair', help='Prefix for per-device pyramid names (rows use `{prefix}-{device_id}`)')
@option('-o', '--out', 'out_path', type=str, default='-', help="Output SQL file ('-' for stdout, default)")
@option('-b', '--bucket', type=str, default='awair', help='R2 bucket to enumerate (default: awair)')
@option('-p', '--prefix', type=str, default='pyramid/', help="Key prefix to walk (default: 'pyramid/')")
def seed_index(
    config_path: Optional[str],
    pyramid_name_prefix: str,
    out_path: str,
    bucket: str,
    prefix: str,
):
    """Walk R2 pyramid shards and emit D1 seed SQL for `pyramid_shards` +
    `pyramid_watermarks`.

    Meant as a one-time post-backfill bootstrap for `cfw/cascade`'s
    `D1ShardIndex`. Statements are idempotent (upsert `ON CONFLICT`),
    so re-running is safe.

    Per-device pyramid names (`{prefix}-{device_id}`) — pyrmts's
    `diffKey` doesn't include a device dim, so sharing a pyramid name
    across devices would collapse all 4 devices' shards into single PK
    rows on upsert. `cfw/cascade` uses the same naming.

    Emit + apply:

        awair pyramid seed-index -o /tmp/seed.sql
        cd cfw/cascade && pnpm wrangler d1 execute awair-cascade --remote --file /tmp/seed.sql
    """
    from ..pyramid.io import _r2_client  # type: ignore[attr-defined]

    config = repo_pyramid_config() if config_path is None else _load_external(config_path)
    tier_by_name = {t.name: t for t in config.tiers}

    r2 = _r2_client()
    paginator = r2.get_paginator('list_objects_v2')
    entries: list[tuple[str, str, str, datetime, datetime, str, datetime]] = []
    #                  ^pyramid ^tier ^shard   ^p_start  ^p_end   ^key  ^written_at

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if not key.endswith('.parquet'):
                continue
            parsed = _parse_pyramid_key(key, prefix=prefix)
            if parsed is None:
                err(f'  SKIP unrecognized key: {key}')
                continue
            device_id, tier_name, period = parsed
            tier = tier_by_name.get(tier_name)
            if tier is None:
                err(f'  SKIP unknown tier {tier_name!r} in key: {key}')
                continue
            try:
                p_start, p_end = parse_period(period, tier.shard)
            except ValueError as e:
                err(f'  SKIP unparseable period in {key}: {e}')
                continue
            written_at = obj['LastModified']
            pyramid_name = f'{pyramid_name_prefix}-{device_id}'
            entries.append((pyramid_name, tier_name, tier.shard, p_start, p_end, key, written_at))

    if not entries:
        err(f'No pyramid shards found under r2://{bucket}/{prefix}')
        return

    err(f'Emitting seed SQL for {len(entries)} shard(s) → {out_path}')
    stream = sys.stdout if out_path == '-' else open(out_path, 'w')
    try:
        stream.write(_seed_sql_header(pyramid_name_prefix))
        # `pyramid_shards`: upsert one row per shard.
        for e in entries:
            stream.write(_shards_insert_sql(*e))
        # `pyramid_watermarks`: one row per (pyramid, tier, shard_dur). Take
        # max(period_end) across shards.
        watermarks: dict[tuple[str, str, str], tuple[int, int]] = {}
        for pyr, tier_name, shard, _p_start, p_end, _key, written_at in entries:
            wm_key = (pyr, tier_name, shard)
            end_ms = int(p_end.timestamp() * 1000)
            written_ms = int(written_at.timestamp() * 1000)
            prev = watermarks.get(wm_key)
            if prev is None or end_ms > prev[0]:
                watermarks[wm_key] = (end_ms, written_ms)
        for (pyr, tier_name, shard), (end_ms, updated_ms) in watermarks.items():
            stream.write(_watermarks_insert_sql(pyr, tier_name, shard, end_ms, updated_ms))
        err(f'Wrote {len(entries)} shard row(s) + {len(watermarks)} watermark row(s).')
    finally:
        if stream is not sys.stdout:
            stream.close()


@pyramid.command('seed-devices')
@option('-o', '--out', 'out_path', type=str, default='-', help="Output SQL file ('-' for stdout, default)")
def seed_devices(out_path: str):
    """Emit SQL to seed the D1 `devices` table from `devices.parquet` +
    computed geneses (earliest S3 monthly shard per device, floored to
    first-of-month UTC).

    Meant as a one-shot bootstrap for Phase 1b. Statements are idempotent
    (UPSERT `ON CONFLICT`).

    Apply:

        awair pyramid seed-devices -o /tmp/seed-devices.sql
        cd cfw/cascade && pnpm wrangler d1 execute awair-cascade --remote --file /tmp/seed-devices.sql
    """
    from .config import get_devices

    devices = get_devices()
    active_devices = [d for d in devices if d.get('active') is not False]
    err(f'Seeding {len(active_devices)} device(s) → {out_path}')

    now_ms = int(datetime.now(tz=None).timestamp() * 1000)
    lines: list[str] = []
    for d in active_devices:
        device_id = int(d['deviceId'])
        name = str(d['name'])
        device_type = str(d.get('deviceType', 'awair-element'))
        genesis_ts = _compute_genesis_ms(device_id)
        active = 1 if d.get('active') is not False else 0
        lines.append(
            'INSERT INTO "devices" '
            '(device_id, name, device_type, genesis_ts, active, last_refreshed_at) '
            f"VALUES ({device_id}, '{_sql_str(name)}', '{_sql_str(device_type)}', "
            f"{genesis_ts}, {active}, {now_ms}) "
            'ON CONFLICT(device_id) DO UPDATE SET '
            'name = excluded.name, device_type = excluded.device_type, '
            'genesis_ts = excluded.genesis_ts, active = excluded.active, '
            'last_refreshed_at = excluded.last_refreshed_at;\n'
        )
        err(f'  device {device_id} ({name}) → genesis={datetime.fromtimestamp(genesis_ts/1000).strftime("%Y-%m")}')

    stream = sys.stdout if out_path == '-' else open(out_path, 'w')
    try:
        stream.write(
            f'-- Seed D1 `devices` table for {len(active_devices)} active device(s).\n'
            f'-- Generated by `awair pyramid seed-devices`. Statements are idempotent.\n\n'
        )
        for line in lines:
            stream.write(line)
    finally:
        if stream is not sys.stdout:
            stream.close()


def _compute_genesis_ms(device_id: int) -> int:
    """First-of-month UTC of the earliest raw monthly shard for `device_id`."""
    import boto3
    from datetime import timezone as _tz
    months = _list_s3_months(device_id)
    if not months:
        raise RuntimeError(f'no raw shards in S3 for device {device_id}')
    y_str, m_str = months[0].split('-')
    return int(datetime(int(y_str), int(m_str), 1, tzinfo=_tz.utc).timestamp() * 1000)


def _parse_pyramid_key(key: str, *, prefix: str) -> Optional[tuple[int, str, str]]:
    """Parse `{prefix}awair-{id}/{tier}/{period}.parquet` → (id, tier, period).

    Returns None if the key doesn't match the expected shape.
    """
    if not key.startswith(prefix):
        return None
    rest = key[len(prefix):]
    parts = rest.split('/')
    if len(parts) != 3:
        return None
    device_dir, tier, period_pq = parts
    if not device_dir.startswith('awair-'):
        return None
    try:
        device_id = int(device_dir[len('awair-'):])
    except ValueError:
        return None
    if not period_pq.endswith('.parquet'):
        return None
    period = period_pq[:-len('.parquet')]
    return device_id, tier, period


def _seed_sql_header(pyramid_name_prefix: str) -> str:
    return (
        f"-- Seed D1 `pyramid_shards` + `pyramid_watermarks` for pyramid names\n"
        f"-- like {pyramid_name_prefix!r}-{{device_id}} (per-tenant separation).\n"
        f"-- Generated by `awair pyramid seed-index`. Statements are idempotent.\n"
        f"-- Apply: cd cfw/cascade && pnpm wrangler d1 execute awair-cascade --remote --file <this-file>\n\n"
    )


def _shards_insert_sql(
    pyramid_name: str, tier: str, shard_dur: str,
    p_start: datetime, p_end: datetime, key: str, written_at: datetime,
) -> str:
    return (
        'INSERT INTO "pyramid_shards" '
        '(pyramid, tier, shard_dur, period_start, period_end, key, written_at) '
        f"VALUES ('{_sql_str(pyramid_name)}', '{_sql_str(tier)}', '{_sql_str(shard_dur)}', "
        f"{int(p_start.timestamp() * 1000)}, {int(p_end.timestamp() * 1000)}, "
        f"'{_sql_str(key)}', {int(written_at.timestamp() * 1000)}) "
        'ON CONFLICT(pyramid, tier, shard_dur, period_start) DO UPDATE SET '
        'period_end = excluded.period_end, key = excluded.key, '
        'written_at = excluded.written_at;\n'
    )


def _watermarks_insert_sql(
    pyramid_name: str, tier: str, shard_dur: str,
    latest_period_end_ms: int, updated_at_ms: int,
) -> str:
    return (
        'INSERT INTO "pyramid_watermarks" '
        '(pyramid, tier, shard_dur, latest_period_end, updated_at) '
        f"VALUES ('{_sql_str(pyramid_name)}', '{_sql_str(tier)}', '{_sql_str(shard_dur)}', "
        f"{latest_period_end_ms}, {updated_at_ms}) "
        'ON CONFLICT(pyramid, tier, shard_dur) DO UPDATE SET '
        'latest_period_end = MAX(excluded.latest_period_end, "pyramid_watermarks".latest_period_end), '
        'updated_at = excluded.updated_at;\n'
    )


def _sql_str(s: str) -> str:
    return s.replace("'", "''")


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
