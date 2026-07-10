// Shard read + coarsen + write. Called by `cascade.ts::convergeOne` for
// each missing shard.
//
// awair's monoid is `sum` for every metric. Coarsening = groupby
// `floor(ts, targetBin)` + column-wise sum on `_n`/`_sum`/`_sumsq`.
// Shards are per-(device_id, tier, period), so `device_id` is constant
// within a shard — the group-by key reduces to just `floored_ts`.

import { parquetReadObjects } from 'hyparquet'
import { ByteWriter, ParquetWriter, schemaFromColumnData } from 'hyparquet-writer'
import {
  addSpan,
  floorToSpan,
  formatPeriod,
  parseDuration,
  shardPeriodsCovering,
  type Shard,
  type Tier,
} from 'pyrmts'
import { PYRAMID_CONFIG, sourceTierFor } from './pyramid'
import type { Device } from './devices'

const METRIC_NAMES = PYRAMID_CONFIG.metrics.map(m => m.name)
const STATE_SUFFIXES = ['_n', '_sum', '_sumsq'] as const

/** Pick a tier's max shard-duration. `shards` is a ladder (unified
 *  shard-duration ladder — commit `2a3d234`), but awair currently
 *  declares one entry per tier so `[last]` == `[0]`. Kept as
 *  `[last]` so we're right when we adopt sub-shard rungs later. */
function maxShard(tier: Tier): Shard {
  const s = tier.shards[tier.shards.length - 1]
  if (s === undefined) throw new Error(`tier ${tier.name} has no shards declared`)
  return s
}

interface AwairRow {
  ts: number             // ms since epoch (source parquet stores INT64 → we normalize to number)
  device_id: number
  [stateCol: string]: number
}

export interface WriteResult {
  status: 'wrote' | 'no_inputs' | 'raw_skip' | 'error'
  key: string
  bytes?: number
  rows?: number
  inputsPresent?: number
  inputsExpected?: number
  error?: string
}

/** Format an R2 key from the pyramid.yml `keyTemplate`. */
function shardKey(deviceId: number, tier: string, periodLabel: string): string {
  return PYRAMID_CONFIG.keyTemplate
    .replaceAll('{device_id}', String(deviceId))
    .replaceAll('{tier}', tier)
    .replaceAll('{period}', periodLabel)
}

/** Coerce a hyparquet cell (bigint | number | string | null) to a plain JS number. */
function asNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  return Number(v)
}

/** Read one source shard from R2, filter rows to `[effStart, effEnd)` in ms. */
async function readSourceShard(
  r2: R2Bucket,
  key: string,
  effStartMs: number,
  effEndMs: number,
): Promise<AwairRow[] | null> {
  const obj = await r2.get(key)
  if (obj === null) return null
  const buf = await obj.arrayBuffer()
  const raw = (await parquetReadObjects({ file: buf })) as Record<string, unknown>[]
  const rows: AwairRow[] = []
  for (const r of raw) {
    const ts = asNum(r['ts'])
    if (ts < effStartMs || ts >= effEndMs) continue
    const out: AwairRow = { ts, device_id: asNum(r['device_id']) }
    for (const m of METRIC_NAMES) {
      for (const suf of STATE_SUFFIXES) {
        const col = `${m}${suf}`
        out[col] = asNum(r[col])
      }
    }
    rows.push(out)
  }
  return rows
}

/**
 * Sum-monoid coarsen: bucket rows by `floor(ts, targetBinMs)` and
 * column-wise sum every `{metric}{_n,_sum,_sumsq}` field per bucket.
 *
 * Emits sorted-by-ts output. `device_id` is constant per-shard, so
 * we assert that assumption and carry it forward on the output rows.
 */
function coarsen(rows: AwairRow[], targetBinMs: number, deviceId: number): AwairRow[] {
  const buckets = new Map<number, AwairRow>()
  for (const row of rows) {
    if (row.device_id !== deviceId) {
      throw new Error(`coarsen: expected device_id=${deviceId}, got ${row.device_id}`)
    }
    const binTs = Math.floor(row.ts / targetBinMs) * targetBinMs
    let out = buckets.get(binTs)
    if (out === undefined) {
      out = { ts: binTs, device_id: deviceId }
      for (const m of METRIC_NAMES) for (const s of STATE_SUFFIXES) out[`${m}${s}`] = 0
      buckets.set(binTs, out)
    }
    for (const m of METRIC_NAMES) {
      for (const s of STATE_SUFFIXES) {
        const col = `${m}${s}`
        out[col] = (out[col] as number) + (row[col] as number)
      }
    }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts)
}

/** Column layout matching the Python builder output (`aggregate_raw` /
 *  `coarsen` in `src/awair/pyramid/builder.py`). */
function rowsToColumns(rows: AwairRow[]) {
  const cols: Array<{ name: string; data: unknown[]; type: 'INT64' | 'INT32' | 'DOUBLE' }> = []
  cols.push({ name: 'ts',        data: rows.map(r => BigInt(r.ts)),        type: 'INT64' })
  cols.push({ name: 'device_id', data: rows.map(r => r.device_id),          type: 'INT32' })
  for (const m of METRIC_NAMES) {
    cols.push({ name: `${m}_n`,     data: rows.map(r => r[`${m}_n`]     as number), type: 'INT32'  })
    cols.push({ name: `${m}_sum`,   data: rows.map(r => r[`${m}_sum`]   as number), type: 'DOUBLE' })
    cols.push({ name: `${m}_sumsq`, data: rows.map(r => r[`${m}_sumsq`] as number), type: 'DOUBLE' })
  }
  return cols
}

/** Serialize rows to a parquet byte buffer. */
function encodeShard(rows: AwairRow[]): Uint8Array {
  const columnData = rowsToColumns(rows)
  const schema = schemaFromColumnData({ columnData })
  const bw = new ByteWriter(64 * 1024)
  // No codec — SNAPPY needs a bundled compressor and ZSTD would need a
  // wasm module. Awair shards are small (<2 MB uncompressed for a full
  // month at raw), so uncompressed is fine for now. Revisit if bytes
  // become a concern.
  const pq = new ParquetWriter({ writer: bw, schema })
  pq.write({ columnData })
  pq.finish()
  return new Uint8Array(bw.buffer, 0, bw.index)
}

export interface WriteOpts {
  r2: R2Bucket
  device: Device
  targetTier: Tier
  targetPeriodStart: Date
  targetPeriodEnd: Date       // exclusive
  effectiveStart: Date        // clipped to genesis / query range
  effectiveEnd: Date          // exclusive
}

/**
 * Write one shard for one device.
 *
 * - raw: no-op (Lambda owns raw writes; skipping keeps cascade purely
 *   derivative and avoids double-writes).
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
  const { r2, device, targetTier, targetPeriodStart, effectiveStart, effectiveEnd } = opts
  const key = shardKey(device.id, targetTier.name, formatPeriod(targetPeriodStart, parseDuration(maxShard(targetTier))))

  if (targetTier.name === 'raw') {
    return { status: 'raw_skip', key }
  }

  const sourceTierName = sourceTierFor(targetTier.name)
  if (sourceTierName === null) {
    return { status: 'error', key, error: `no source tier for ${targetTier.name}` }
  }
  const sourceTier = PYRAMID_CONFIG.tiers.find(t => t.name === sourceTierName)
  if (sourceTier === undefined) {
    return { status: 'error', key, error: `unknown source tier ${sourceTierName}` }
  }

  const sourcePeriods = shardPeriodsCovering(effectiveStart, effectiveEnd, maxShard(sourceTier))
  if (sourcePeriods.length === 0) {
    return { status: 'no_inputs', key, inputsPresent: 0, inputsExpected: 0 }
  }

  const effStartMs = effectiveStart.getTime()
  const effEndMs = effectiveEnd.getTime()

  const allRows: AwairRow[] = []
  let inputsPresent = 0
  for (const period of sourcePeriods) {
    const sourceKey = shardKey(device.id, sourceTier.name, period.label)
    const rows = await readSourceShard(r2, sourceKey, effStartMs, effEndMs)
    if (rows === null) continue
    inputsPresent++
    for (const row of rows) allRows.push(row)
  }

  if (allRows.length === 0) {
    return { status: 'no_inputs', key, inputsPresent, inputsExpected: sourcePeriods.length }
  }

  const targetBinMs = targetBinToMs(targetTier.bin)
  const coarsened = coarsen(allRows, targetBinMs, device.id)
  const bytes = encodeShard(coarsened)
  await r2.put(key, bytes)

  return {
    status: 'wrote',
    key,
    bytes: bytes.byteLength,
    rows: coarsened.length,
    inputsPresent,
    inputsExpected: sourcePeriods.length,
  }
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
