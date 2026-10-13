// Shard read + coarsen + write. Called by `cascade.ts::convergeOne` for
// each missing shard.
//
// awair's monoid is `sum` for every metric. Coarsening = groupby
// `floor(ts, targetBin)` + column-wise sum on `_n`/`_sum`/`_sumsq`.
// Shards are per-(device_id, tier, period), so `device_id` is constant
// within a shard — the group-by key reduces to just `floored_ts`.

import {
  addSpan,
  floorToSpan,
  formatPeriod,
  listExpectedShards,
  parseDuration,
  shardPeriodsCovering,
  tileFromExisting,
  type ExpectedShard,
  type Shard,
  type Tier,
} from 'pyrmts'
import { makePyramid, PYRAMID_CONFIG, sourceTierFor } from './pyramid'
import type { Device } from './devices'
import { coarsen, encodeShard, FOOTER_CACHE_SIZE, readSourceShard, type AwairRow } from './rows'
import { DEFAULT_SOURCE_ROOT, reconcileMonth } from './reconcile'

export interface WriteResult {
  status: 'wrote' | 'no_inputs' | 'raw_skip' | 'incomplete' | 'error'
  key: string
  bytes?: number
  rows?: number
  // Last 64 KiB of the written parquet body — cached in D1 so `cfw/serve
  // /q` can skip the metadata fetch (see `0004_footer_cache.sql`). Only
  // present when `status === 'wrote'`.
  footerBytes?: Uint8Array
  inputsPresent?: number
  inputsExpected?: number
  error?: string
}

/** Format an R2 key from the pyramid.yml `keyTemplate`. `{shard}` is
 *  required by the current template to disambiguate rungs that would
 *  otherwise share a period label — see `pyramid.yml`. */
function shardKey(deviceId: number, tier: string, shard: Shard, periodLabel: string): string {
  return PYRAMID_CONFIG.keyTemplate
    .replaceAll('{device_id}', String(deviceId))
    .replaceAll('{tier}', tier)
    .replaceAll('{shard}', shard)
    .replaceAll('{period}', periodLabel)
}

export interface WriteOpts {
  r2: R2Bucket
  device: Device
  targetTier: Tier
  /** Which rung of `targetTier.shards` this write is for. Determines
   *  the key's period label (e.g. `2026-07-13` for a 1d rung vs
   *  `2026-07-13T14` for a 1h rung). */
  targetShardDur: Shard
  targetPeriodStart: Date
  targetPeriodEnd: Date       // exclusive
  effectiveStart: Date        // clipped to genesis / query range
  effectiveEnd: Date          // exclusive
  now?: Date
  deadline?: number
  sourceRoot?: string
  /** Missing/stale expected inputs remain unusable even if an old R2 body exists. */
  unavailableSourceKeys?: ReadonlySet<string>
}

/**
 * Write one shard for one device.
 *
 * - raw daily: skip the live tip owned by Lambda.
 * - raw monthly: reconcile the closed S3 source, then consolidate daily tiles.
 * - Everything else: enumerate source-tier periods intersecting the
 *   effective range, read each source shard, coarsen to target bin,
 *   write.
 *
 * `inputsExpected` counts source periods intersecting `[effectiveStart,
 * effectiveEnd)` — this is what pyrmts's `ExpectedShard.effective*`
 * clipping is for (a genesis-straddling shard emits fewer expected
 * inputs than its notional period would suggest).
 */
export async function writeShard(opts: WriteOpts): Promise<WriteResult> {
  const { r2, device, targetTier, targetShardDur, targetPeriodStart, targetPeriodEnd, effectiveStart, effectiveEnd } = opts
  const key = shardKey(device.id, targetTier.name, targetShardDur, formatPeriod(targetPeriodStart, parseDuration(targetShardDur)))

  if (targetTier.name === 'raw') {
    const finestRung = targetTier.shards[0]!
    if (targetShardDur === finestRung) {
      // Lambda owns the tip — no cascade write.
      return { status: 'raw_skip', key }
    }
    // Same-tier consolidation: raw/{coarser rung}/period ← concat raw/{finer rung}/*.
    // Cross-tier cascade can't build raw (no source tier); tileFromExisting
    // walks the calendar-aware slot grid, picks existing sub-rung tiles.
    return await consolidateRawShard({
      r2, device, targetTier, targetShardDur,
      targetPeriodStart, targetPeriodEnd, key,
      now: opts.now ?? new Date(),
      deadline: opts.deadline ?? Date.now() + 25_000,
      sourceRoot: opts.sourceRoot ?? DEFAULT_SOURCE_ROOT,
    })
  }

  const sourceTierName = sourceTierFor(targetTier.name)
  if (sourceTierName === null) {
    return { status: 'error', key, error: `no source tier for ${targetTier.name}` }
  }
  const sourceTier = PYRAMID_CONFIG.tiers.find(t => t.name === sourceTierName)
  if (sourceTier === undefined) {
    return { status: 'error', key, error: `unknown source tier ${sourceTierName}` }
  }

  // Source-shard enumeration depends on whether the source is single- or
  // multi-rung. See docstring above.
  const filter = { device_id: device.id }
  const sourceKeys = enumerateSourceKeys(sourceTier, device, effectiveStart, effectiveEnd, filter, r2)
  if (sourceKeys.length === 0) {
    return { status: 'no_inputs', key, inputsPresent: 0, inputsExpected: 0 }
  }

  const effStartMs = effectiveStart.getTime()
  const effEndMs = effectiveEnd.getTime()

  const allRows: AwairRow[] = []
  let inputsPresent = 0
  for (const srcKey of sourceKeys) {
    if (opts.unavailableSourceKeys?.has(srcKey)) continue
    const rows = await readSourceShard(r2, srcKey, effStartMs, effEndMs)
    if (rows === null) continue
    inputsPresent++
    for (const row of rows) allRows.push(row)
  }

  if (inputsPresent !== sourceKeys.length) {
    return { status: 'incomplete', key, inputsPresent, inputsExpected: sourceKeys.length }
  }

  const targetBinMs = targetBinToMs(targetTier.bin)
  const coarsened = coarsen(allRows, targetBinMs, device.id)
  const bytes = encodeShard(coarsened)
  await r2.put(key, bytes)

  // Grab the tail slice for D1's footer cache. If the shard is smaller
  // than the cache window, use the whole buffer.
  const footerStart = Math.max(0, bytes.byteLength - FOOTER_CACHE_SIZE)
  const footerBytes = bytes.slice(footerStart)

  return {
    status: 'wrote',
    key,
    bytes: bytes.byteLength,
    rows: coarsened.length,
    footerBytes,
    inputsPresent,
    inputsExpected: sourceKeys.length,
  }
}

/**
 * Same-tier consolidation for the raw tier: build the coarser-rung shard
 * (e.g. `raw/1mo/YYYY-MM.parquet`) from existing finer-rung tiles
 * (e.g. 28–31 `raw/1d/YYYY-MM-DD.parquet` shards) via `tileFromExisting`.
 *
 * Reconcile the closed authoritative S3 month first, including explicit
 * zero-row daily tiles. A failed source fetch or a missing tile still
 * returns `incomplete`; only complete input inventory reaches D1.
 */
async function consolidateRawShard(opts: {
  r2: R2Bucket
  device: Device
  targetTier: Tier
  targetShardDur: Shard
  targetPeriodStart: Date
  targetPeriodEnd: Date
  key: string
  now: Date
  deadline: number
  sourceRoot: string
}): Promise<WriteResult> {
  const { r2, device, targetTier, targetShardDur, targetPeriodStart, targetPeriodEnd, key } = opts
  if (targetShardDur !== '1mo') throw new Error('Raw reconciliation requires a monthly target')
  const ready = await reconcileMonth({
    r2, device, month: targetPeriodStart.toISOString().slice(0, 7),
    now: opts.now, deadline: opts.deadline, sourceRoot: opts.sourceRoot, repair: true,
  })
  if (!ready) return { status: 'incomplete', key, inputsPresent: 0, inputsExpected: 1 }
  const pyramid = makePyramid(r2)
  const filter = { device_id: device.id }

  // List existing raw shards under this device's prefix. Every rung of
  // the raw tier lives under `pyramid/awair-{device_id}/raw/`; each
  // finer-rung tile is one entry.
  const listPrefix = `pyramid/awair-${device.id}/raw/`
  const keySet = new Set<string>()
  let cursor: string | undefined
  do {
    const listing = await r2.list({ prefix: listPrefix, cursor, limit: 1000 })
    for (const obj of listing.objects) keySet.add(obj.key)
    cursor = listing.truncated ? listing.cursor : undefined
  } while (cursor)

  const gap: ExpectedShard = {
    tier: targetTier.name,
    shardDur: targetShardDur,
    periodStart: targetPeriodStart,
    periodEnd: targetPeriodEnd,
    effectiveStart: targetPeriodStart,
    effectiveEnd: targetPeriodEnd,
    key,
  }
  const { picks, holes } = tileFromExisting(pyramid, targetTier, gap, keySet, {
    genesis: device.genesisDate,
    filter,
  })

  if (holes.length > 0) {
    return {
      status: 'incomplete',
      key,
      inputsPresent: picks.length,
      inputsExpected: picks.length + holes.length,
    }
  }

  // Read each pick's rows (no bin filter — sub-tile bin matches target
  // bin by definition; whole file's rows are in-period). Concat + sort.
  const allRows: AwairRow[] = []
  const periodStartMs = targetPeriodStart.getTime()
  const periodEndMs = targetPeriodEnd.getTime()
  if (Date.now() >= opts.deadline) {
    return { status: 'incomplete', key, inputsPresent: 0, inputsExpected: picks.length }
  }
  const inputs = await Promise.all(picks.map(pick => readSourceShard(r2, pick.key, periodStartMs, periodEndMs)))
  const inputsPresent = inputs.filter(rows => rows !== null).length
  if (Date.now() >= opts.deadline) {
    return { status: 'incomplete', key, inputsPresent, inputsExpected: picks.length }
  }
  for (const rows of inputs) {
    if (rows === null) {
      // Raced a delete? Bail — cascade will retry next tick.
      return { status: 'incomplete', key, inputsPresent, inputsExpected: picks.length }
    }
    for (const row of rows) allRows.push(row)
  }
  allRows.sort((a, b) => a.ts - b.ts)

  const bytes = encodeShard(allRows)
  await r2.put(key, bytes)
  const footerStart = Math.max(0, bytes.byteLength - FOOTER_CACHE_SIZE)
  const footerBytes = bytes.slice(footerStart)

  return {
    status: 'wrote',
    key,
    bytes: bytes.byteLength,
    rows: allRows.length,
    footerBytes,
    inputsPresent,
    inputsExpected: picks.length,
  }
}

/**
 * Enumerate source shard keys covering `[effStart, effEnd)` for
 * `sourceTier`.
 *
 * Single-rung source (e.g. raw with `[1mo]`): use `shardPeriodsCovering`
 * on the sole rung. This includes the current partial-period tile
 * (Lambda writes to it continuously); `listExpectedShards`
 * gap-discovery would skip that tile because single-rung ladders have
 * no smaller-rung to tile the trailing-partial window.
 *
 * Multi-rung source: use `listExpectedShards` over `[genesis, now]` —
 * this gives the min-cover across all rungs (max-rung tiles for closed
 * history, smaller rungs for the trailing partial), which is what
 * cascade actually writes. Filter to those overlapping the target's
 * effective range.
 */
function enumerateSourceKeys(
  sourceTier: Tier,
  device: Device,
  effStart: Date,
  effEnd: Date,
  filter: Record<string, string | number>,
  r2: R2Bucket,
): string[] {
  if (sourceTier.shards.length === 1) {
    const rung = sourceTier.shards[0]!
    const periods = shardPeriodsCovering(effStart, effEnd, rung)
    return periods.map(p => shardKey(device.id, sourceTier.name, rung, p.label))
  }
  const sourcePyramid = makePyramid(r2)
  const now = new Date()
  const from = device.genesisDate < effStart ? device.genesisDate : effStart
  const to = now > effEnd ? now : effEnd
  return listExpectedShards(sourcePyramid, { from, to }, filter)
    .filter(e => e.tier === sourceTier.name)
    .filter(e => e.effectiveEnd > effStart && e.effectiveStart < effEnd)
    .map(e => e.key)
}

/** Convert a pyrmts bin duration to a fixed ms count. Only supports the
 *  fixed-width tier bins in the awair pyramid (min/h/d) — calendar-aware
 *  bins (mo/y) would need real month/year math, but our monthly-1mo and
 *  monthly-1y tiers use *shard* durations there, not bin durations. */
function targetBinToMs(bin: string): number {
  const span = parseDuration(bin)
  const startMs = 0
  const endMs = addSpan(new Date(startMs), span).getTime()
  return endMs - startMs
}

// Referenced by cascade.ts.
export { shardKey, floorToSpan }
