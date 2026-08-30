/**
 * `awair-cascade`: Cloudflare Worker that maintains awair pyrmts tier
 * shards.
 *
 * Endpoints (all CORS-open):
 *   Cron * * * * *   → `convergeAll` (25s budget, silent no-op ticks
 *                       when nothing missing)
 *   GET /health      → `{ok: true, worker: 'awair-cascade'}` (Phase 2 will
 *                       replace with a real HealthSnapshot)
 *   GET /converge    → manual trigger for smoke tests / bootstrap.
 *                       Secret-gated via `MANUAL_KEY` (`?key=…`) — set via
 *                       `wrangler secret put MANUAL_KEY`.
 *                       Query params: `?devices=17617,137496&tiers=m5,m30&dryRun=1`
 */

import { convergeAll, type ConvergeAllReport } from './cascade'
import { backfillFooterCache, type BackfillReport } from './backfill'
import { runHealthMonitor } from './monitor'
import { parseEvent, recordEvent, summarize } from './events'

interface Env {
  PYRAMID: R2Bucket
  DB: D1Database
  DEVICES_URL: string
  TOTAL_BUDGET_MS: string
  // Prefix for per-device pyramid names (`${prefix}-{device_id}`). Prod
  // defaults to `awair`; the `dev` wrangler env overrides to `awair-dev`.
  PYRAMID_NAME?: string  // read as pyramidNamePrefix
  MANUAL_KEY?: string
  // Health monitor (see `monitor.ts`). All optional: unset Pushover creds
  // ⇒ evaluate + persist state but send nothing; unset `SERVE_URL` ⇒ skip
  // the serve probe.
  PUSHOVER_TOKEN?: string
  PUSHOVER_USER?: string
  SERVE_URL?: string
  HEALTH_RAW_TIP_MAX_AGE_MS?: string
  HEALTH_CASCADE_MAX_LAG_MS?: string
  HEALTH_SERVE_EMPTY_MIN_CONSECUTIVE?: string
}

function parseBudget(env: Env): number {
  const n = Number.parseInt(env.TOTAL_BUDGET_MS, 10)
  return Number.isFinite(n) && n > 0 ? n : 25_000
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }
}

async function runConverge(env: Env, url: URL): Promise<ConvergeAllReport> {
  const deviceIds = url.searchParams.get('devices')?.split(',').map(s => Number.parseInt(s, 10)).filter(Number.isFinite)
  const tiers = url.searchParams.get('tiers')?.split(',').map(s => s.trim()).filter(Boolean)
  const dryRun = ['1', 'true', 'yes'].includes(url.searchParams.get('dryRun') ?? '')
  return convergeAll(
    { PYRAMID: env.PYRAMID, DB: env.DB },
    {
      totalBudgetMs: parseBudget(env),
      pyramidNamePrefix: env.PYRAMID_NAME,
      deviceIds: deviceIds && deviceIds.length > 0 ? deviceIds : undefined,
      tiers: tiers && tiers.length > 0 ? tiers : undefined,
      dryRun,
    },
  )
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      convergeAll(
        { PYRAMID: env.PYRAMID, DB: env.DB },
        { totalBudgetMs: parseBudget(env), pyramidNamePrefix: env.PYRAMID_NAME },
      )
        .then(r => {
          // Log summary; per-device details are noise on quiet ticks.
          // `results` carries per-shard `footerBytes` blobs (up to 64 KiB
          // each) that blow past the 256 KiB tail log cap — strip them
          // for the summary log; `stats` + `results.status` already give
          // us the shape.
          const totalMissing = r.perDevice.reduce((s, d) => s + (d.totalMissing ?? 0), 0)
          const errored = r.perDevice.filter(d => d.status === 'error')
          if (totalMissing > 0 || errored.length > 0) {
            const trimmed = {
              ...r,
              perDevice: r.perDevice.map(d => ({
                ...d,
                results: d.results?.map(x => ({
                  status: x.status, key: x.key, rows: x.rows, bytes: x.bytes,
                  inputsPresent: x.inputsPresent, inputsExpected: x.inputsExpected,
                  error: x.error,
                })),
              })),
            }
            console.log(JSON.stringify(trimmed))
          } else console.log(`convergeAll: quiet tick (${r.elapsedMs}ms, ${r.perDevice.length} devices)`)
        })
        .catch(e => console.error('convergeAll failed:', (e as Error).message, (e as Error).stack)),
    )
    // Independent of converge: evaluate health + page Pushover on
    // transitions. Cheap (a HEAD + a D1 read per device, plus an optional
    // serve probe) and self-contained (never throws).
    ctx.waitUntil(runHealthMonitor(env))
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }

    if (url.pathname === '/health') {
      // Phase 2 replaces this with the real HealthSnapshot. Kept
      // returning 200 now so wrangler + smoke tests have a stable probe.
      return new Response(JSON.stringify({ ok: true, worker: 'awair-cascade' }) + '\n', {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' },
      })
    }

    // Telemetry sink for FE beacons (`client_empty` / `client_error`). Kept
    // CORS-open + parse-tolerant so `navigator.sendBeacon` (text/plain, no
    // preflight) lands. See `events.ts` / migration `0007`.
    if (url.pathname === '/event' && req.method === 'POST') {
      try {
        const body = await req.text()
        const ev = parseEvent(JSON.parse(body) as unknown)
        if (ev === null) return new Response('bad event\n', { status: 400, headers: corsHeaders() })
        await recordEvent(env.DB, ev)
        console.log(JSON.stringify({ serveEvent: ev }))
        return new Response(null, { status: 204, headers: corsHeaders() })
      } catch {
        return new Response('bad event\n', { status: 400, headers: corsHeaders() })
      }
    }

    // Rolling anomaly summary. `?days=` (default 7) window, `?limit=`
    // (default 50) recent rows. Open (no secret) — device ids + query
    // params only.
    if (url.pathname === '/events') {
      const now = Date.now()
      const days = Number.parseInt(url.searchParams.get('days') ?? '7', 10)
      const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
      const since = now - (Number.isFinite(days) && days > 0 ? days : 7) * 86_400_000
      const summary = await summarize(env.DB, since, now, Number.isFinite(limit) && limit > 0 ? limit : 50)
      return new Response(JSON.stringify(summary, null, 2) + '\n', {
        status: 200,
        headers: { ...corsHeaders(), 'content-type': 'application/json' },
      })
    }

    if (url.pathname === '/backfill-cache') {
      if (env.MANUAL_KEY) {
        if (url.searchParams.get('key') !== env.MANUAL_KEY) {
          return new Response('forbidden\n', { status: 403, headers: corsHeaders() })
        }
      }
      try {
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '200', 10)
        const report: BackfillReport = await backfillFooterCache(
          { PYRAMID: env.PYRAMID, DB: env.DB },
          { totalBudgetMs: parseBudget(env), limit: Number.isFinite(limit) && limit > 0 ? limit : 200 },
        )
        return new Response(JSON.stringify(report, null, 2) + '\n', {
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json' },
        })
      } catch (e) {
        return new Response(`error: ${(e as Error).message}\n`, { status: 500, headers: corsHeaders() })
      }
    }

    if (url.pathname === '/converge') {
      if (env.MANUAL_KEY) {
        if (url.searchParams.get('key') !== env.MANUAL_KEY) {
          return new Response('forbidden\n', { status: 403, headers: corsHeaders() })
        }
      }
      try {
        const report = await runConverge(env, url)
        return new Response(JSON.stringify(report, null, 2) + '\n', {
          status: 200,
          headers: { ...corsHeaders(), 'content-type': 'application/json' },
        })
      } catch (e) {
        return new Response(`error: ${(e as Error).message}\n${(e as Error).stack ?? ''}\n`, {
          status: 500,
          headers: corsHeaders(),
        })
      }
    }

    return new Response(
      'awair-cascade endpoints:\n' +
      '  GET  /health\n' +
      '  GET  /converge?devices=&tiers=&dryRun=1 (secret-gated via ?key= when MANUAL_KEY set)\n' +
      '  POST /event   (serve-anomaly telemetry sink; FE beacons)\n' +
      '  GET  /events?days=7&limit=50 (rolling serve-anomaly summary)\n',
      { status: 404, headers: corsHeaders() },
    )
  },
}
