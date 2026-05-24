/**
 * `awair-serve`: Cloudflare Worker that serves pyrmts pyramid queries for
 * awair sensor data. Reads tier shards from R2; binning/aggregation is
 * pre-computed by `awair pyramid build`.
 *
 * Endpoints:
 *   GET /q      pyrmts serveQuery (see pyrmts-cfw for query-param grammar)
 *   GET /health "ok"
 *
 * Watermarks: derived lazily from R2 head-object timestamps of the
 * current-period raw shard for each device. (Per-tier watermarks could be
 * computed similarly; for v0.1 we only watermark `raw` and treat coarser
 * tiers as authoritative through `to`.)
 */

import { parsePyramidYaml, pyramidFromConfig, type Pyramid } from 'pyrmts'
import { r2Storage, serveQuery } from 'pyrmts-cfw'
import pyramidYamlText from '../../../pyramid.yml'

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
        cors: true,
      })
    }

    return new Response(
      'awair-serve: GET /q?from=<ISO>&to=<ISO>&device_id=<id>&bin_budget=<n> | GET /health\n',
      { status: 404, headers: corsHeaders(request) },
    )
  },
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
