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

import { parsePyramidYaml, pyramidFromConfig, type Pyramid } from 'pyrmts'
import { r2Storage, serveQuery } from 'pyrmts-cfw'
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
      const pyramid: Pyramid = pyramidFromConfig(pyramidConfig, r2Storage(env.PYRAMID))
      return serveQuery({
        pyramid,
        request,
        watermarks: req => resolveWatermarks(req, env),
        tolerateMissingShards: true,
        cors: true,
      })
    }

    return new Response(
      'awair-serve: GET /q?from=<ISO>&to=<ISO>&device_id=<id>&bin_budget=<n> | GET /health\n',
      { status: 404, headers: corsHeaders(request) },
    )
  },
}

/**
 * Resolve per-tier watermarks for the requested device by HEADing each tier's
 * current-period shard in R2 and using its `uploaded` timestamp. Missing
 * shards yield no entry, which the planner treats as "complete through `to`".
 */
async function resolveWatermarks(
  request: Request,
  env: Env,
): Promise<Record<string, Date>> {
  const url = new URL(request.url)
  const deviceId = url.searchParams.get('device_id')
  if (deviceId === null) return {}

  const now = new Date()
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  const y = String(now.getUTCFullYear())

  const heads = await Promise.all(
    pyramidConfig.tiers.map(async tier => {
      const period = tier.shard === '1mo' ? ym : tier.shard === '1y' ? y : null
      if (period === null) return [tier.name, null] as const
      const key = pyramidConfig.keyTemplate
        .replaceAll('{device_id}', deviceId)
        .replaceAll('{tier}', tier.name)
        .replaceAll('{period}', period)
      try {
        const obj = await env.PYRAMID.head(key)
        return [tier.name, obj?.uploaded ?? null] as const
      } catch {
        return [tier.name, null] as const
      }
    }),
  )

  const out: Record<string, Date> = {}
  for (const [name, ts] of heads) {
    if (ts !== null) out[name] = ts
  }
  return out
}

interface WatermarkRow {
  pyramid: string
  tier: string
  shard_dur: string
  latest_period_end: number
  updated_at: number
}

interface ShardStatsRow {
  pyramid: string
  tier: string
  shard_dur: string
  shard_count: number
  latest_written_at: number
  earliest_period_start: number
  latest_period_end: number
}

interface TierHealth {
  tier: string
  shardDur: string
  shardCount: number
  latestPeriodEnd: number | null
  earliestPeriodStart: number | null
  latestWrittenAt: number | null
  d1UpdatedAt: number | null
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

  const batchResults = await env.DB.batch<
    DeviceRow | WatermarkRow | ShardStatsRow
  >([
    env.DB.prepare(
      'SELECT device_id, name, device_type, genesis_ts, active FROM devices ORDER BY device_id',
    ),
    env.DB.prepare(
      'SELECT pyramid, tier, shard_dur, latest_period_end, updated_at FROM pyramid_watermarks',
    ),
    env.DB.prepare(
      `SELECT pyramid, tier, shard_dur,
              COUNT(*) AS shard_count,
              MAX(written_at) AS latest_written_at,
              MIN(period_start) AS earliest_period_start,
              MAX(period_end) AS latest_period_end
       FROM pyramid_shards
       GROUP BY pyramid, tier, shard_dur`,
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
  const shards = shardsRes.results as unknown as ShardStatsRow[]

  // Bucket D1 rows by pyramid name (= `awair-{device_id}`) → tier.
  const wmIdx = new Map<string, WatermarkRow>()
  for (const w of watermarks) wmIdx.set(`${w.pyramid}|${w.tier}|${w.shard_dur}`, w)
  const shardIdx = new Map<string, ShardStatsRow>()
  for (const s of shards) shardIdx.set(`${s.pyramid}|${s.tier}|${s.shard_dur}`, s)

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
      const wm = wmIdx.get(`${pyramidName}|${t.name}|${t.shard}`) ?? null
      const st = shardIdx.get(`${pyramidName}|${t.name}|${t.shard}`) ?? null
      return {
        tier: t.name,
        shardDur: t.shard,
        shardCount: st?.shard_count ?? 0,
        latestPeriodEnd: st?.latest_period_end ?? wm?.latest_period_end ?? null,
        earliestPeriodStart: st?.earliest_period_start ?? null,
        latestWrittenAt: st?.latest_written_at ?? null,
        d1UpdatedAt: wm?.updated_at ?? null,
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
      tiers: pyramidConfig.tiers.map(t => ({ name: t.name, bin: t.bin, shard: t.shard })),
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
