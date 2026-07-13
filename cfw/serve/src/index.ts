/**
 * `awair-serve`: Cloudflare Worker that serves pyrmts pyramid queries for
 * awair sensor data. Reads tier shards from R2; binning/aggregation is
 * pre-computed by `awair pyramid build`.
 *
 * Endpoints:
 *   GET /q       pyrmts serveQuery (see pyrmts-cfw for query-param grammar)
 *   GET /devices D1 devices table, JSON
 *   GET /health  Full HealthSnapshot: per-device raw R2 watermarks +
 *                per-(device, tier) shard counts / latest cascade write
 *                / D1 watermark from `pyramid_shards` + `pyramid_watermarks`
 *   GET /health?probe=1  Minimal 200 for uptime checks
 *
 * Watermarks (for /q): each request HEADs every tier's current-period shard in
 * parallel and uses R2 `uploaded` (Last-Modified) as the watermark. The
 * pyrmts planner clamps coarser tiers to never exceed finer tiers'
 * watermarks, so stale coarse-tier shards trigger re-aggregation from
 * fresher raw at the query's tail (per `PlanSegment.reaggregate`).
 *
 * `tolerateMissingShards: true` lets pyrmts return [] for objects that
 * don't exist (e.g. yearly d1 shards before a device started recording)
 * instead of erroring the whole query.
 */

import { parquetBackend, parsePyramidYaml, pyramidFromConfig, type Pyramid, type Storage } from 'pyrmts'
import { D1ShardIndex, r2Storage, serveQuery } from 'pyrmts-cfw'
import pyramidYamlText from '../../../src/awair/pyramid.yml'

interface Env {
  PYRAMID: R2Bucket
  DB: D1Database
}

interface DeviceRow {
  device_id: number
  name: string
  device_type: string
  genesis_ts: number
  active: number
}

// Parse the YAML once at module load — the config is immutable per deploy.
const pyramidConfig = parsePyramidYaml(pyramidYamlText)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return preflight(request)
    }

    if (url.pathname === '/health') {
      if (url.searchParams.get('probe') !== null) {
        return new Response('ok\n', { status: 200, headers: corsHeaders(request) })
      }
      try {
        const body = await buildHealthSnapshot(env)
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: {
            ...corsHeaders(request),
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        })
      } catch (e) {
        return new Response(`health: ${(e as Error).message}\n`, { status: 500, headers: corsHeaders(request) })
      }
    }

    if (url.pathname === '/devices') {
      // FE calls this instead of fetching `s3://380nwk/devices.parquet`
      // — same table `cfw/cascade` reads for its converge loop, so
      // there's a single source of truth for both.
      try {
        const { results } = await env.DB.prepare(
          'SELECT device_id, name, device_type, genesis_ts, active ' +
          'FROM devices WHERE active = 1 ORDER BY device_id',
        ).all<DeviceRow>()
        // Map to a stable JSON shape (camelCase, ISO genesis) so the FE
        // isn't coupled to D1 column names.
        const body = results.map(r => ({
          deviceId: r.device_id,
          name: r.name,
          deviceType: r.device_type,
          genesisTs: r.genesis_ts,
          active: r.active === 1,
        }))
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { ...corsHeaders(request), 'content-type': 'application/json' },
        })
      } catch (e) {
        return new Response(`devices: ${(e as Error).message}\n`, { status: 500, headers: corsHeaders(request) })
      }
    }

    if (url.pathname === '/q') {
      // `?debug=1` wraps `r2Storage` so every `getRange` call gets recorded
      // as a `FetchTrace` entry. The pinned pyrmts version (61f091b) doesn't
      // yet expose per-slice traces via serveQuery, so we tap the storage
      // layer directly — that captures every byte-range against R2, which
      // is what we actually care about for metadata-vs-data breakdown.
      const debug = url.searchParams.get('debug') !== null
      const cacheOff = url.searchParams.get('no_cache') !== null
      return await serveQueryWithCache(request, env, { debug, cacheEnabled: !cacheOff })
    }

    return new Response(
      'awair-serve: GET /q?from=<ISO>&to=<ISO>&device_id=<id>&bin_budget=<n> | GET /health\n',
      { status: 404, headers: corsHeaders(request) },
    )
  },
}

interface FetchTrace {
  key: string
  start: number
  end: number
  length: number
  ms: number
  // Where the bytes came from. `r2` = round-trip to R2; `d1_cache` = served
  // from D1 `pyramid_shards.footer_bytes` cache (see `0004_footer_cache.sql`).
  source: 'r2' | 'd1_cache'
}

/**
 * Wrap `r2Storage` with:
 *  1. Cache: on the first `getRange(K, …)` per key, look up D1
 *     `pyramid_shards.size_bytes` (small — a single INTEGER). If the
 *     request's `end` matches, load `footer_bytes` (the up-to-64 KiB
 *     blob) and serve from D1. Subsequent calls for the same key
 *     re-use the cached size/bytes without hitting D1. The pyrmts
 *     fetcher is size-agnostic — it just calls `getRange` on offsets
 *     derived from `head.size` — so this is invisible to the library.
 *  2. Trace: record every call to `traces` for `?debug=1` reporting,
 *     tagged with `source: 'r2' | 'd1_cache'`.
 */
function wrappedStorage(
  inner: Storage,
  env: Env,
  traces: FetchTrace[],
  cacheEnabled: boolean,
): Storage {
  // Per-request memo. A `null` entry means "D1 lookup done, no cache
  // available (row missing or size_bytes null)" — don't re-query.
  interface CacheEntry {
    size: number
    bytes: Uint8Array | null  // lazily loaded on first size match
  }
  const cacheByKey = new Map<string, CacheEntry | null>()

  async function loadMeta(key: string): Promise<CacheEntry | null> {
    if (cacheByKey.has(key)) return cacheByKey.get(key) ?? null
    const row = await env.DB.prepare(
      `SELECT size_bytes FROM pyramid_shards
       WHERE key = ? AND footer_bytes IS NOT NULL AND size_bytes IS NOT NULL
       LIMIT 1`,
    ).bind(key).first<{ size_bytes: number | null }>()
    const entry: CacheEntry | null = row?.size_bytes != null
      ? { size: row.size_bytes, bytes: null }
      : null
    cacheByKey.set(key, entry)
    return entry
  }

  async function loadBytes(key: string, entry: CacheEntry): Promise<Uint8Array | null> {
    if (entry.bytes !== null) return entry.bytes
    const row = await env.DB.prepare(
      `SELECT footer_bytes FROM pyramid_shards
       WHERE key = ? AND size_bytes = ? AND footer_bytes IS NOT NULL
       LIMIT 1`,
    ).bind(key, entry.size).first<{ footer_bytes: ArrayBuffer | Uint8Array | null }>()
    if (row?.footer_bytes == null) return null
    entry.bytes = row.footer_bytes instanceof Uint8Array
      ? row.footer_bytes
      : new Uint8Array(row.footer_bytes)
    return entry.bytes
  }

  return {
    ...inner,
    async getRange(key, start, end) {
      const t0 = Date.now()
      const length = end - start
      if (cacheEnabled) {
        const meta = await loadMeta(key)
        // Cache-hit condition: request's window is a tail slice
        // (`end === size`) sitting inside the cached bytes region
        // (`start >= size - cached.length`). Pyrmts issues
        // `end = file_size` only for the parquet metadata fetch.
        if (meta !== null && end === meta.size) {
          const bytes = await loadBytes(key, meta)
          if (bytes !== null) {
            const cacheStart = meta.size - bytes.length
            if (start >= cacheStart) {
              const off = start - cacheStart
              const slice = bytes.slice(off, off + length)
              traces.push({ key, start, end, length, ms: Date.now() - t0, source: 'd1_cache' })
              return slice
            }
          }
        }
      }
      try {
        return await inner.getRange(key, start, end)
      } finally {
        traces.push({ key, start, end, length, ms: Date.now() - t0, source: 'r2' })
      }
    },
  }
}

/**
 * Serve `/q` with D1 footer cache + optional per-slice tracing.
 *
 * `?debug=1` attaches `{summary, perKey, traces}` to the JSON body.
 * `?no_cache=1` disables the D1 footer cache for A/B measurement.
 *
 * Heuristic phase classification (used in rollups): the first `getRange`
 * per key is the parquet metadata (footer / suffix); subsequent ranges
 * are column-chunk (data) reads. Correct for the current pyrmts backend.
 */
async function serveQueryWithCache(
  request: Request,
  env: Env,
  opts: { debug: boolean; cacheEnabled: boolean },
): Promise<Response> {
  const traces: FetchTrace[] = []
  const storage = wrappedStorage(r2Storage(env.PYRAMID), env, traces, opts.cacheEnabled)
  const pyramid: Pyramid = pyramidFromConfig(pyramidConfig, parquetBackend(storage))
  // Inventory-driven planning via `shardIndex`. Cascade tiles the current
  // partial period with progressively smaller rungs of a multi-rung
  // ladder, and D1 records exactly what was written — the planner walks
  // that inventory rather than guessing shard existence from the ladder
  // shape. Requires `pyramidName` (per-device, `awair-{device_id}`)
  // derived from the query filter.
  //
  // Watermarks are still passed for the raw tier only — pyrmts uses
  // `pyramid.tiers[0]`'s watermark to compute `authoritativeEnd`
  // (fresh-through-instant). All other tiers plan from inventory.
  const url = new URL(request.url)
  const deviceId = url.searchParams.get('device_id')
  const pyramidName = deviceId !== null ? `awair-${deviceId}` : undefined
  const inner = await serveQuery({
    pyramid,
    request,
    watermarks: req => resolveWatermarks(req, env),
    tolerateMissingShards: true,
    cors: true,
    ...(pyramidName !== undefined ? { shardIndex: new D1ShardIndex(env.DB), pyramidName } : {}),
  })

  if (!opts.debug) {
    return new Response(inner.body, {
      status: inner.status,
      headers: { ...corsHeaders(request), 'content-type': 'application/json' },
    })
  }

  const body = await inner.json() as Record<string, unknown>

  // Roll up per-key + phase (metadata vs data) totals.
  const seenKeys = new Set<string>()
  const perKey: Record<string, {
    metadataBytes: number; metadataCalls: number;
    dataBytes: number; dataCalls: number;
    cachedBytes: number; cachedCalls: number;
    totalMs: number
  }> = {}
  let totalBytes = 0
  let totalMs = 0
  let metadataBytes = 0
  let dataBytes = 0
  let cachedBytes = 0
  let cachedCalls = 0
  let r2Bytes = 0
  for (const t of traces) {
    const phase: 'metadata' | 'data' = seenKeys.has(t.key) ? 'data' : 'metadata'
    seenKeys.add(t.key)
    const bucket = perKey[t.key] ?? (perKey[t.key] = {
      metadataBytes: 0, metadataCalls: 0,
      dataBytes: 0, dataCalls: 0,
      cachedBytes: 0, cachedCalls: 0,
      totalMs: 0,
    })
    bucket.totalMs += t.ms
    if (phase === 'metadata') {
      bucket.metadataBytes += t.length
      bucket.metadataCalls++
      metadataBytes += t.length
    } else {
      bucket.dataBytes += t.length
      bucket.dataCalls++
      dataBytes += t.length
    }
    if (t.source === 'd1_cache') {
      bucket.cachedBytes += t.length
      bucket.cachedCalls++
      cachedBytes += t.length
      cachedCalls++
    } else {
      r2Bytes += t.length
    }
    totalBytes += t.length
    totalMs += t.ms
  }

  const debug = {
    summary: {
      totalCalls: traces.length,
      totalBytes,
      totalMs,
      metadataBytes,
      dataBytes,
      metadataPct: totalBytes > 0 ? metadataBytes / totalBytes : 0,
      keysTouched: Object.keys(perKey).length,
      cacheEnabled: opts.cacheEnabled,
      cachedCalls,
      cachedBytes,
      r2Bytes,
      cacheHitPct: totalBytes > 0 ? cachedBytes / totalBytes : 0,
    },
    perKey,
    traces,
  }
  const merged = { ...body, debug }
  return new Response(JSON.stringify(merged), {
    status: inner.status,
    headers: { ...corsHeaders(request), 'content-type': 'application/json' },
  })
}

/**
 * Resolve per-tier watermarks for the requested device by HEADing each tier's
 * current-period shard in R2 and using its `uploaded` timestamp. Missing
 * shards yield no entry, which the planner treats as "complete through `to`".
 */
/** Return `{raw: <uploaded time of current-month raw shard>}` — the
 *  raw tier's freshness. That's the only tier `planQueryFromInventory`
 *  reads a watermark for (used to compute `authoritativeEnd`); all
 *  other tiers plan against `shardIndex` (D1 inventory), so their
 *  freshness comes from whether cascade has written the current-tail
 *  small-rung shard, not from a watermark.
 *
 *  Lambda writes raw every minute so this is ~always ≈ now. */
async function resolveWatermarks(
  request: Request,
  env: Env,
): Promise<Record<string, Date>> {
  const url = new URL(request.url)
  const deviceId = url.searchParams.get('device_id')
  if (deviceId === null) return {}
  const rawTier = pyramidConfig.tiers[0]
  if (rawTier === undefined || rawTier.name !== 'raw') return {}
  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const key = pyramidConfig.keyTemplate
    .replaceAll('{device_id}', deviceId)
    .replaceAll('{tier}', 'raw')
    .replaceAll('{period}', ym)
  try {
    const obj = await env.PYRAMID.head(key)
    if (obj === null) return {}
    return { raw: obj.uploaded }
  } catch {
    return {}
  }
}

interface WatermarkRow {
  pyramid: string
  tier: string
  shard_dur: string
  latest_period_end: number
  updated_at: number
}

interface ShardRow {
  pyramid: string
  tier: string
  shard_dur: string
  period_start: number
  period_end: number
  key: string
  written_at: number
  size_bytes: number | null
  n_rows: number | null
  n_rgs: number | null
  rg_row_counts: string | null  // JSON array of ints
}

interface HealthShard {
  shardDur: string
  periodStart: number
  periodEnd: number
  writtenAt: number
  sizeBytes: number | null
  nRows: number | null
  nRgs: number | null
  rgRowCounts: number[] | null
}

interface TierStats {
  // Averages computed across shards where the stat is non-null. `count`
  // is the number of shards that contributed. If `count == 0` the value
  // is `null` (shown as `—` on the FE).
  avgSizeBytes: number | null
  avgNRows: number | null
  avgNRgs: number | null
  avgRowsPerRg: number | null
  count: number
}

interface TierHealth {
  tier: string
  shardDur: string
  shardCount: number
  latestPeriodEnd: number | null
  earliestPeriodStart: number | null
  latestWrittenAt: number | null
  d1UpdatedAt: number | null
  stats: TierStats
  // Per-shard rows keyed on (period_start). Used by the FE to draw the
  // coverage timeline. Sorted by period_start ascending.
  shards: HealthShard[]
}

interface DeviceRawHealth {
  deviceId: number
  key: string
  uploaded: number | null
  ageMs: number | null
  size: number | null
}

interface PyramidHealth {
  pyramid: string
  deviceId: number
  tiers: TierHealth[]
}

interface HealthSnapshot {
  now: number
  worker: 'awair-serve'
  devices: {
    deviceId: number
    name: string
    deviceType: string
    genesisTs: number
    active: boolean
  }[]
  raw: DeviceRawHealth[]
  pyramids: PyramidHealth[]
  config: {
    keyTemplate: string
    tiers: { name: string; bin: string; shard: string }[]
  }
}

/**
 * Assemble a full health snapshot: canonical device list, per-device raw
 * R2 watermarks (source of truth for freshness — Lambda writes bypass D1),
 * and per-(device, tier) cascade progress from D1's `pyramid_watermarks` +
 * `pyramid_shards` tables.
 */
async function buildHealthSnapshot(env: Env): Promise<HealthSnapshot> {
  const now = Date.now()

  // Pull raw shard rows and derive per-tier stats in JS — total is small
  // (per-tenant × per-tier × O(months); tens of rows in prod today), well
  // under D1's payload limits, and folds the aggregation with the
  // per-shard timeline data the FE needs.
  const batchResults = await env.DB.batch<
    DeviceRow | WatermarkRow | ShardRow
  >([
    env.DB.prepare(
      'SELECT device_id, name, device_type, genesis_ts, active FROM devices ORDER BY device_id',
    ),
    env.DB.prepare(
      'SELECT pyramid, tier, shard_dur, latest_period_end, updated_at FROM pyramid_watermarks',
    ),
    env.DB.prepare(
      `SELECT pyramid, tier, shard_dur, period_start, period_end, key, written_at,
              size_bytes, n_rows, n_rgs, rg_row_counts
       FROM pyramid_shards
       ORDER BY pyramid, tier, shard_dur, period_start`,
    ),
  ])
  const [devicesRes, watermarksRes, shardsRes] = batchResults
  if (!devicesRes || !watermarksRes || !shardsRes) {
    throw new Error('D1 batch returned fewer results than expected')
  }

  const devices = (devicesRes.results as unknown as DeviceRow[]).map(r => ({
    deviceId: r.device_id,
    name: r.name,
    deviceType: r.device_type,
    genesisTs: r.genesis_ts,
    active: r.active === 1,
  }))

  const watermarks = watermarksRes.results as unknown as WatermarkRow[]
  const shardRows = shardsRes.results as unknown as ShardRow[]

  // Bucket D1 rows by (pyramid, tier, shard_dur). Watermarks are point,
  // shards are lists.
  const wmIdx = new Map<string, WatermarkRow>()
  for (const w of watermarks) wmIdx.set(`${w.pyramid}|${w.tier}|${w.shard_dur}`, w)
  const shardsByKey = new Map<string, ShardRow[]>()
  for (const s of shardRows) {
    const k = `${s.pyramid}|${s.tier}|${s.shard_dur}`
    let list = shardsByKey.get(k)
    if (!list) { list = []; shardsByKey.set(k, list) }
    list.push(s)
  }

  const ym = `${new Date(now).getUTCFullYear()}-${String(new Date(now).getUTCMonth() + 1).padStart(2, '0')}`

  // Raw watermark: HEAD each device's current-month raw shard in parallel.
  // Lambda writes directly to R2 and doesn't update D1, so this is the only
  // authoritative freshness signal for the raw tier.
  const rawHealth = await Promise.all(
    devices.map(async (d): Promise<DeviceRawHealth> => {
      const key = pyramidConfig.keyTemplate
        .replaceAll('{device_id}', String(d.deviceId))
        .replaceAll('{tier}', 'raw')
        .replaceAll('{period}', ym)
      try {
        const obj = await env.PYRAMID.head(key)
        if (obj === null) {
          return { deviceId: d.deviceId, key, uploaded: null, ageMs: null, size: null }
        }
        const uploaded = obj.uploaded.getTime()
        return {
          deviceId: d.deviceId,
          key,
          uploaded,
          ageMs: now - uploaded,
          size: obj.size,
        }
      } catch {
        return { deviceId: d.deviceId, key, uploaded: null, ageMs: null, size: null }
      }
    }),
  )

  // One PyramidHealth per active device, keyed on `awair-{device_id}`.
  const pyramids: PyramidHealth[] = devices.map(d => {
    const pyramidName = `awair-${d.deviceId}`
    const tiers: TierHealth[] = pyramidConfig.tiers.map(t => {
      const tShard = t.shards[t.shards.length - 1]!
      const key = `${pyramidName}|${t.name}|${tShard}`
      const wm = wmIdx.get(key) ?? null
      const shards = shardsByKey.get(key) ?? []
      // Derive aggregates in JS instead of a second GROUP BY.
      let earliest: number | null = null
      let latestEnd: number | null = null
      let latestWritten: number | null = null
      // Per-tier stat sums, ignoring shards where the value is null (not
      // yet backfilled). `avg = sum / count` at the end.
      let sizeSum = 0, sizeN = 0
      let rowsSum = 0, rowsN = 0
      let rgsSum = 0, rgsN = 0
      let rpgSum = 0, rpgN = 0
      const outShards: HealthShard[] = []
      for (const s of shards) {
        if (earliest === null || s.period_start < earliest) earliest = s.period_start
        if (latestEnd === null || s.period_end > latestEnd) latestEnd = s.period_end
        if (latestWritten === null || s.written_at > latestWritten) latestWritten = s.written_at
        if (s.size_bytes !== null) { sizeSum += s.size_bytes; sizeN++ }
        if (s.n_rows !== null)     { rowsSum += s.n_rows;     rowsN++ }
        if (s.n_rgs !== null)      { rgsSum  += s.n_rgs;      rgsN++  }
        if (s.n_rows !== null && s.n_rgs !== null && s.n_rgs > 0) {
          rpgSum += s.n_rows / s.n_rgs
          rpgN++
        }
        let rgRowCounts: number[] | null = null
        if (s.rg_row_counts !== null) {
          try { rgRowCounts = JSON.parse(s.rg_row_counts) as number[] } catch { rgRowCounts = null }
        }
        outShards.push({
          shardDur: s.shard_dur,
          periodStart: s.period_start,
          periodEnd: s.period_end,
          writtenAt: s.written_at,
          sizeBytes: s.size_bytes,
          nRows: s.n_rows,
          nRgs: s.n_rgs,
          rgRowCounts,
        })
      }
      const stats: TierStats = {
        avgSizeBytes:  sizeN > 0 ? sizeSum / sizeN : null,
        avgNRows:      rowsN > 0 ? rowsSum / rowsN : null,
        avgNRgs:       rgsN  > 0 ? rgsSum  / rgsN  : null,
        avgRowsPerRg:  rpgN  > 0 ? rpgSum  / rpgN  : null,
        count:         shards.length,
      }
      return {
        tier: t.name,
        shardDur: tShard,
        shardCount: shards.length,
        latestPeriodEnd: latestEnd ?? wm?.latest_period_end ?? null,
        earliestPeriodStart: earliest,
        latestWrittenAt: latestWritten,
        d1UpdatedAt: wm?.updated_at ?? null,
        stats,
        shards: outShards,
      }
    })
    return { pyramid: pyramidName, deviceId: d.deviceId, tiers }
  })

  return {
    now,
    worker: 'awair-serve',
    devices,
    raw: rawHealth,
    pyramids,
    config: {
      keyTemplate: pyramidConfig.keyTemplate,
      tiers: pyramidConfig.tiers.map(t => ({ name: t.name, bin: t.bin, shard: t.shards[t.shards.length - 1]! })),
    },
  }
}

function corsHeaders(_request: Request): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
