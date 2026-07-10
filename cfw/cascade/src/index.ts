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

interface Env {
  R2: R2Bucket
  DB: D1Database
  DEVICES_URL: string
  TOTAL_BUDGET_MS: string
  PYRAMID_NAME?: string
  MANUAL_KEY?: string
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
    { R2: env.R2, DB: env.DB },
    {
      totalBudgetMs: parseBudget(env),
      pyramidName: env.PYRAMID_NAME,
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
        { R2: env.R2, DB: env.DB },
        { totalBudgetMs: parseBudget(env), pyramidName: env.PYRAMID_NAME },
      )
        .then(r => {
          // Log summary; per-device details are noise on quiet ticks.
          const total = r.perDevice.reduce((s, d) => s + (d.totalMissing ?? 0), 0)
          if (total > 0) console.log(JSON.stringify(r))
          else console.log(`convergeAll: quiet tick (${r.elapsedMs}ms, ${r.perDevice.length} devices)`)
        })
        .catch(e => console.error('convergeAll failed:', (e as Error).message, (e as Error).stack)),
    )
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
      '  GET /health\n' +
      '  GET /converge?devices=&tiers=&dryRun=1 (secret-gated via ?key= when MANUAL_KEY set)\n',
      { status: 404, headers: corsHeaders() },
    )
  },
}
