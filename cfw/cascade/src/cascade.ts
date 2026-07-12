// `convergeAll` (per-device sequential loop) + `convergeOne` (single
// device: gap-discover → sort → write with time budget).
//
// Modeled after ctbk's `gbfs/cascade/src/avail3/cascade.ts::converge`,
// adapted for awair's multi-tenant layout (4 devices, single pyramid
// config, `filter={device_id}` per-tenant). No cross-tier ingest — the
// raw tier is Lambda's job and cascade skips it.

import {
  listMissingShards,
  type ExpectedShard,
  type Tier,
} from 'pyrmts'
import { D1ShardIndex } from 'pyrmts-cfw'
import { readDevices, type Device } from './devices'
import { DEFAULT_PYRAMID_NAME_PREFIX, makePyramid, PYRAMID_CONFIG, pyramidNameFor, RAW_TIER, TIER_ORDER } from './pyramid'
import { writeShard, type WriteResult } from './write'

export interface ConvergeAllOpts {
  now?: Date
  totalBudgetMs?: number
  // Per-tenant pyramid names are `${pyramidNamePrefix}-{device_id}`. See
  // `pyramid.ts` for why we tenant-separate at this granularity.
  pyramidNamePrefix?: string
  // Optional filters (mainly for `/converge?...` manual invocations).
  deviceIds?: number[]
  tiers?: string[]
  dryRun?: boolean
}

export interface PerDeviceReport {
  deviceId: number
  name: string
  status: 'ok' | 'error' | 'skipped-budget'
  error?: string
  results?: WriteResult[]
  stats?: Record<string, number>
  totalMissing?: number
  stoppedReason?: 'time' | 'ops'
}

export interface ConvergeAllReport {
  now: string
  pyramidNamePrefix: string
  totalBudgetMs: number
  elapsedMs: number
  perDevice: PerDeviceReport[]
}

const TIER_INDEX: Map<string, number> = new Map(TIER_ORDER.map((n, i) => [n, i]))

/**
 * Sort missing shards so finer-tier / smaller-period-first — coarser
 * consumers write after their finer sources land. Within a tier, prefer
 * shards with the smallest `shardDur` (i.e. non-max rungs go first,
 * matching pyrmts min-cover semantics). Finally, tie-break on
 * periodStart ascending.
 */
function sortMissing(a: ExpectedShard, b: ExpectedShard): number {
  const ai = TIER_INDEX.get(a.tier) ?? Infinity
  const bi = TIER_INDEX.get(b.tier) ?? Infinity
  if (ai !== bi) return ai - bi
  if (a.shardDur !== b.shardDur) return a.shardDur < b.shardDur ? -1 : 1
  return a.periodStart.getTime() - b.periodStart.getTime()
}

/**
 * Converge one device. Returns the per-device shape used by
 * `PerDeviceReport`.
 */
async function convergeOne(
  env: { R2: R2Bucket; DB: D1Database },
  device: Device,
  now: Date,
  opts: {
    pyramidNamePrefix: string
    remainingBudgetMs: number
    tierFilter: Set<string> | null
    dryRun: boolean
  },
): Promise<Omit<PerDeviceReport, 'deviceId' | 'name' | 'status'>> {
  const started = Date.now()
  const pyramid = makePyramid(env.R2)
  const shardIndex = new D1ShardIndex(env.DB)
  const pyramidName = pyramidNameFor(device.id, opts.pyramidNamePrefix)

  // Range = [device.genesis, now]. pyrmts clips shards to
  // `effective{Start,End}` around this — pre-genesis periods are pruned,
  // straddling shards get their `inputsExpected` correctly discounted.
  const range = { from: device.genesisDate, to: now }
  const filter = { device_id: device.id }

  let missing = await listMissingShards(pyramid, pyramidName, shardIndex, range, filter)

  // Cascade never writes raw — filter it out entirely.
  missing = missing.filter(m => m.tier !== RAW_TIER)
  if (opts.tierFilter !== null) missing = missing.filter(m => opts.tierFilter!.has(m.tier))
  missing.sort(sortMissing)

  const totalMissing = missing.length
  const results: WriteResult[] = []
  const stats: Record<string, number> = {}
  let stopped: 'time' | undefined

  for (const m of missing) {
    if (Date.now() - started >= opts.remainingBudgetMs) { stopped = 'time'; break }
    const tier = PYRAMID_CONFIG.tiers.find(t => t.name === m.tier) as Tier
    if (opts.dryRun) {
      const exists = await env.R2.head(m.key)
      const r: WriteResult = { status: exists ? 'wrote' : 'no_inputs', key: m.key }
      results.push(r); stats[r.status] = (stats[r.status] ?? 0) + 1
      continue
    }
    const r = await writeShard({
      r2: env.R2,
      device,
      targetTier: tier,
      targetPeriodStart: m.periodStart,
      targetPeriodEnd: m.periodEnd,
      effectiveStart: m.effectiveStart,
      effectiveEnd: m.effectiveEnd,
    })
    results.push(r); stats[r.status] = (stats[r.status] ?? 0) + 1

    if (r.status === 'wrote' &&
        r.inputsPresent !== undefined &&
        r.inputsExpected !== undefined &&
        r.inputsPresent === r.inputsExpected) {
      await shardIndex.recordShard({
        pyramidName,
        tier: m.tier,
        shardDur: m.shardDur,
        periodStart: m.periodStart,
        periodEnd: m.periodEnd,
        key: r.key,
      })
      // Stats columns aren't part of pyrmts' ShardIndex API — stamp them
      // directly. All cascade writes are single-RG (one `.write()` call
      // in `write.ts::encodeShard`), so n_rgs=1 and rg_row_counts=[rows].
      // If the writer ever splits into multiple RGs, update this.
      if (r.bytes !== undefined && r.rows !== undefined) {
        await env.DB.prepare(
          `UPDATE pyramid_shards
             SET size_bytes = ?, n_rows = ?, n_rgs = ?, rg_row_counts = ?
           WHERE pyramid = ? AND tier = ? AND shard_dur = ? AND period_start = ?`,
        ).bind(
          r.bytes,
          r.rows,
          1,
          JSON.stringify([r.rows]),
          pyramidName,
          m.tier,
          m.shardDur,
          m.periodStart.getTime(),
        ).run()
      }
    }
  }

  return { results, stats, totalMissing, stoppedReason: stopped }
}

/**
 * Per-device sequential loop with a shared wall-clock budget. Failure
 * in one device is contained (try/catch → error status) and the loop
 * continues to the next device with whatever budget remains.
 */
export async function convergeAll(
  env: { R2: R2Bucket; DB: D1Database },
  opts: ConvergeAllOpts = {},
): Promise<ConvergeAllReport> {
  const now = opts.now ?? new Date()
  const totalBudgetMs = opts.totalBudgetMs ?? 25_000
  const pyramidNamePrefix = opts.pyramidNamePrefix ?? DEFAULT_PYRAMID_NAME_PREFIX
  const deviceIdsFilter = opts.deviceIds ? new Set(opts.deviceIds) : null
  const tierFilter = opts.tiers ? new Set(opts.tiers) : null
  const dryRun = opts.dryRun ?? false
  const started = Date.now()

  const perDevice: PerDeviceReport[] = []
  const allDevices = await readDevices(env.DB)
  const devices = deviceIdsFilter
    ? allDevices.filter(d => deviceIdsFilter.has(d.id))
    : allDevices

  for (const device of devices) {
    const remainingBudgetMs = totalBudgetMs - (Date.now() - started)
    if (remainingBudgetMs <= 500) {
      perDevice.push({ deviceId: device.id, name: device.name, status: 'skipped-budget' })
      continue
    }
    try {
      const r = await convergeOne(env, device, now, {
        pyramidNamePrefix, remainingBudgetMs, tierFilter, dryRun,
      })
      perDevice.push({ deviceId: device.id, name: device.name, status: 'ok', ...r })
    } catch (e) {
      perDevice.push({
        deviceId: device.id,
        name: device.name,
        status: 'error',
        error: (e as Error).message ?? String(e),
      })
    }
  }

  return {
    now: now.toISOString(),
    pyramidNamePrefix,
    totalBudgetMs,
    elapsedMs: Date.now() - started,
    perDevice,
  }
}
