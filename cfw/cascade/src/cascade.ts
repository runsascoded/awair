// `convergeAll` (per-device sequential loop) + `convergeOne` (single
// device: gap-discover → sort → write with time budget).
//
// Modeled after ctbk's `gbfs/cascade/src/avail3/cascade.ts::converge`,
// adapted for awair's multi-tenant layout (4 devices, single pyramid
// config, `filter={device_id}` per-tenant). No cross-tier ingest — the
// raw tier is Lambda's job and cascade skips it.

import {
  listExpectedShards,
  listMissingShards,
  loadInvalidations,
  pruneSpent,
  type ExpectedShard,
  type Tier,
} from 'pyrmts'
import { D1ShardIndex, r2Storage } from 'pyrmts-cfw'
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

// Stale detection is now `listMissingShards({invalidations})` from
// pyrmts (`~/c/pyrmts/specs/shard-invalidation.md`). Lambda appends
// journal entries after each raw write (`awair.lmbda.updater
// .write_pyrmts_raw_shard` → `pyrmts_engine.invalidation.invalidate`);
// this file's convergeOne loads the journal per tick and passes it
// through so `staleKeysFor` marks any recorded shard overlapping a
// still-open invalidation with `writtenAt < requestedAt` for rebuild.
// (Previous interim implementation polled R2 HEAD for source mtimes;
// journal is cheaper — one JSON blob per pyramid vs one HEAD per
// source key.)

/**
 * Converge one device. Returns the per-device shape used by
 * `PerDeviceReport`.
 */
async function convergeOne(
  env: { PYRAMID: R2Bucket; DB: D1Database },
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
  const pyramid = makePyramid(env.PYRAMID)
  const shardIndex = new D1ShardIndex(env.DB)
  const pyramidName = pyramidNameFor(device.id, opts.pyramidNamePrefix)

  // Range = [device.genesis, now]. pyrmts clips shards to
  // `effective{Start,End}` around this — pre-genesis periods are pruned,
  // straddling shards get their `inputsExpected` correctly discounted.
  const range = { from: device.genesisDate, to: now }
  const filter = { device_id: device.id }

  // Journal-based invalidation via pyrmts. See file docstring under
  // "Stale detection". Load once per (device × tick) — reasonable
  // since the journal is a single JSON blob per pyramid.
  const storage = r2Storage(env.PYRAMID)
  const [invalidations] = await loadInvalidations(pyramid, storage)

  let work = await listMissingShards(
    pyramid, pyramidName, shardIndex, range, filter, { invalidations },
  )

  // Cascade writes only the coarser-than-tip rungs of raw (via same-tier
  // consolidation in `write.ts::consolidateRawShard`); Lambda owns the tip
  // rung (`raw.shards[0]`). Filter out raw's tip so cascade never races
  // Lambda's writes.
  const rawTier = PYRAMID_CONFIG.tiers.find(t => t.name === RAW_TIER)!
  const rawTipRung = rawTier.shards[0]!
  work = work.filter(m => !(m.tier === RAW_TIER && m.shardDur === rawTipRung))
  if (opts.tierFilter !== null) work = work.filter(m => opts.tierFilter!.has(m.tier))
  work.sort(sortMissing)

  const totalMissing = work.length
  const results: WriteResult[] = []
  const stats: Record<string, number> = {}
  let stopped: 'time' | undefined

  for (const m of work) {
    if (Date.now() - started >= opts.remainingBudgetMs) { stopped = 'time'; break }
    const tier = PYRAMID_CONFIG.tiers.find(t => t.name === m.tier) as Tier
    if (opts.dryRun) {
      const exists = await env.PYRAMID.head(m.key)
      const r: WriteResult = { status: exists ? 'wrote' : 'no_inputs', key: m.key }
      results.push(r); stats[r.status] = (stats[r.status] ?? 0) + 1
      continue
    }
    const r = await writeShard({
      r2: env.PYRAMID,
      device,
      targetTier: tier,
      targetShardDur: m.shardDur,
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
      // Stats + footer cache aren't part of pyrmts' ShardIndex API — stamp
      // them directly. All cascade writes are single-RG (one `.write()`
      // call in `write.ts::encodeShard`), so n_rgs=1 and
      // rg_row_counts=[rows]. If the writer ever splits into multiple
      // RGs, update this.
      if (r.bytes !== undefined && r.rows !== undefined) {
        await env.DB.prepare(
          `UPDATE pyramid_shards
             SET size_bytes = ?, n_rows = ?, n_rgs = ?, rg_row_counts = ?,
                 footer_bytes = ?
           WHERE pyramid = ? AND tier = ? AND shard_dur = ? AND period_start = ?`,
        ).bind(
          r.bytes,
          r.rows,
          1,
          JSON.stringify([r.rows]),
          r.footerBytes ?? null,
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
 * Prune spent invalidation-journal entries. Awair's journal is
 * per-pyramid-prefix (`pyramid/awair-_invalidations.json`), shared
 * across all 4 device pyramids — so we can only prune an entry when
 * NO device has an overlapping stale shard for it. Build combined
 * `expected` + `mtimes` (keyed by shard R2 key, which is unique per
 * device since `{device_id}` is in the template).
 */
async function pruneJournal(
  env: { PYRAMID: R2Bucket; DB: D1Database },
  devices: Device[],
  now: Date,
  pyramidNamePrefix: string,
): Promise<void> {
  const pyramid = makePyramid(env.PYRAMID)
  const shardIndex = new D1ShardIndex(env.DB)
  const storage = r2Storage(env.PYRAMID)
  const combinedExpected: ExpectedShard[] = []
  const combinedMtimes = new Map<string, Date | null>()
  for (const device of devices) {
    const range = { from: device.genesisDate, to: now }
    const filter = { device_id: device.id }
    const expected = listExpectedShards(pyramid, range, filter)
    combinedExpected.push(...expected)
    const recorded = await shardIndex.listShards(pyramidNameFor(device.id, pyramidNamePrefix))
    const recordedByKey = new Map<string, Date | null>()
    for (const r of recorded) recordedByKey.set(r.key, r.writtenAt ?? null)
    for (const e of expected) {
      if (recordedByKey.has(e.key)) combinedMtimes.set(e.key, recordedByKey.get(e.key)!)
    }
  }
  const [pruned, remaining] = await pruneSpent(pyramid, storage, combinedExpected, { mtimes: combinedMtimes })
  if (pruned > 0) console.log(`pruneSpent: dropped ${pruned}, kept ${remaining}`)
}

/**
 * Per-device sequential loop with a shared wall-clock budget. Failure
 * in one device is contained (try/catch → error status) and the loop
 * continues to the next device with whatever budget remains.
 */
export async function convergeAll(
  env: { PYRAMID: R2Bucket; DB: D1Database },
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

  // Rotate device order each minute so no single device starves the
  // others out of the 25s tick budget. Without this, the device with
  // the most stale/missing shards (e.g. the oldest genesis) uses the
  // full budget on every tick and the rest stay at 0. Offset by
  // `nowMinutes % N` — since ticks fire ~1× per minute, each device
  // gets first-priority once per N minutes.
  const rotationOffset = Math.floor(now.getTime() / 60_000) % Math.max(devices.length, 1)
  const rotatedDevices = [...devices.slice(rotationOffset), ...devices.slice(0, rotationOffset)]

  for (const device of rotatedDevices) {
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

  // Prune spent invalidation entries — journal is shared across all
  // devices for this pyramid prefix (`pyrmts.journalKey`), so build
  // combined `expected` + `mtimes` across all devices before calling
  // `pruneSpent` (an entry is spent only when NO device still has a
  // stale shard overlapping it). Skip on dry-run + budget-exhausted to
  // avoid extra R2 CAS work on quiet ticks; the journal is small
  // enough that we don't lose much by pruning only when there was
  // real work.
  if (!dryRun && Date.now() - started < totalBudgetMs) {
    try {
      await pruneJournal(env, devices, now, pyramidNamePrefix)
    } catch (e) {
      console.error('pruneSpent failed:', (e as Error).message)
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
