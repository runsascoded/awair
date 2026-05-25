/**
 * `awair-serve`: Cloudflare Worker that serves pyrmts pyramid queries for
 * awair sensor data. Reads tier shards from R2; binning/aggregation is
 * pre-computed by `awair pyramid build`.
 *
 * Endpoints:
 *   GET /q      pyrmts serveQuery (see pyrmts-cfw for query-param grammar)
 *   GET /health "ok"
 *
 * Watermarks: each request HEADs every tier's current-period shard in
 * parallel and uses R2 `uploaded` (Last-Modified) as the watermark. The
 * pyrmts planner clamps coarser tiers to never exceed finer tiers'
 * watermarks, so stale coarse-tier shards trigger re-aggregation from
 * fresher raw at the query's tail (per `PlanSegment.reaggregate`).
 */

import { parsePyramidYaml, pyramidFromConfig, type Pyramid } from 'pyrmts'
import { r2Storage, serveQuery } from 'pyrmts-cfw'
import pyramidYamlText from '../../../src/awair/pyramid.yml'

interface Env {
  PYRAMID: R2Bucket
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
      return new Response('ok\n', { status: 200, headers: corsHeaders(request) })
    }

    if (url.pathname === '/q') {
      const pyramid: Pyramid = pyramidFromConfig(pyramidConfig, r2Storage(env.PYRAMID))
      return serveQuery({
        pyramid,
        request,
        watermarks: (req) => resolveWatermarks(req, env),
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
    pyramidConfig.tiers.map(async (tier) => {
      const period = tier.shard === '1mo' ? ym : tier.shard === '1y' ? y : null
      if (period === null) {
        // Unsupported shard span for watermark derivation; skip.
        return [tier.name, null] as const
      }
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
