// I/O orchestration for the health monitor: reads R2 / D1 / the serve
// worker, applies the pure `transition` logic from `health.ts`, persists
// per-check state in D1, and pages Pushover on transitions. Kept separate
// from `health.ts` so the decision logic stays unit-testable without mocks.

import { readDevices, type Device } from './devices'
import { recordEvent } from './events'
import {
  DEFAULT_THRESHOLDS,
  humanDuration,
  transition,
  utcDayLabel,
  type Alert,
  type CheckResult,
  type HealthThresholds,
  type StateRow,
} from './health'
import { PYRAMID_CONFIG, pyramidNameFor } from './pyramid'

export interface MonitorEnv {
  PYRAMID: R2Bucket
  DB: D1Database
  // Service binding to the serve worker (`serve-empty` probe). Preferred
  // over a `SERVE_URL` fetch, which loops back to this worker on the shared
  // workers.dev subdomain. When unset, falls back to `SERVE_URL`.
  SERVE?: Fetcher
  PYRAMID_NAME?: string
  // Pushover credentials (set via `wrangler secret put`). When either is
  // unset the monitor still evaluates + persists state but sends nothing.
  PUSHOVER_TOKEN?: string
  PUSHOVER_USER?: string
  // Serve worker origin (e.g. `https://awair-serve.ryan-0dc.workers.dev`).
  // When unset the `serve-empty` probe is skipped.
  SERVE_URL?: string
  // Optional threshold overrides (ms / count as strings).
  HEALTH_RAW_TIP_MAX_AGE_MS?: string
  HEALTH_CASCADE_MAX_LAG_MS?: string
  HEALTH_SERVE_EMPTY_MIN_CONSECUTIVE?: string
}

function thresholdsFrom(env: MonitorEnv): HealthThresholds {
  const numOr = (s: string | undefined, d: number): number => {
    if (s === undefined) return d
    const n = Number.parseInt(s, 10)
    return Number.isFinite(n) && n > 0 ? n : d
  }
  return {
    ...DEFAULT_THRESHOLDS,
    rawTipMaxAgeMs: numOr(env.HEALTH_RAW_TIP_MAX_AGE_MS, DEFAULT_THRESHOLDS.rawTipMaxAgeMs),
    cascadeMaxLagMs: numOr(env.HEALTH_CASCADE_MAX_LAG_MS, DEFAULT_THRESHOLDS.cascadeMaxLagMs),
    serveEmptyMinConsecutive: numOr(
      env.HEALTH_SERVE_EMPTY_MIN_CONSECUTIVE,
      DEFAULT_THRESHOLDS.serveEmptyMinConsecutive,
    ),
  }
}

/** Build the current-day raw tip R2 key for a device. */
function rawTipKey(deviceId: number, now: number): string {
  const raw = PYRAMID_CONFIG.tiers[0]!
  return PYRAMID_CONFIG.keyTemplate
    .replaceAll('{device_id}', String(deviceId))
    .replaceAll('{tier}', raw.name)
    .replaceAll('{shard}', String(raw.shards[0]!))
    .replaceAll('{period}', utcDayLabel(now))
}

/** Lambda liveness: HEAD each device's current-day raw tip; fail if
 *  missing or older than `rawTipMaxAgeMs`. */
async function checkRawTips(
  env: MonitorEnv, devices: Device[], now: number, t: HealthThresholds,
): Promise<CheckResult[]> {
  return Promise.all(devices.map(async (dev): Promise<CheckResult> => {
    const id = `raw-tip:${dev.id}`
    try {
      const obj = await env.PYRAMID.head(rawTipKey(dev.id, now))
      if (obj === null) {
        return { id, ok: false, detail: `${dev.name} (${dev.id}): no raw tip for ${utcDayLabel(now)}`, minConsecutive: 1 }
      }
      const age = now - obj.uploaded.getTime()
      const ok = age <= t.rawTipMaxAgeMs
      return { id, ok, detail: `${dev.name} (${dev.id}): raw tip ${humanDuration(age)} old`, minConsecutive: 1 }
    } catch (e) {
      return { id, ok: false, detail: `${dev.name} (${dev.id}): raw-tip HEAD failed — ${(e as Error).message}`, minConsecutive: 1 }
    }
  }))
}

/** Cascade liveness: newest `cascadeTier` shard per device; fail if its
 *  `period_end` lags `now` by more than `cascadeMaxLagMs`. */
async function checkCascadeLag(
  env: MonitorEnv, devices: Device[], now: number, t: HealthThresholds,
): Promise<CheckResult[]> {
  const prefix = env.PYRAMID_NAME
  return Promise.all(devices.map(async (dev): Promise<CheckResult> => {
    const id = `cascade-lag:${dev.id}`
    try {
      const row = await env.DB
        .prepare('SELECT MAX(period_end) AS mx FROM pyramid_shards WHERE pyramid = ? AND tier = ?')
        .bind(pyramidNameFor(dev.id, prefix), t.cascadeTier)
        .first<{ mx: number | null }>()
      const mx = row?.mx ?? null
      if (mx === null) {
        return { id, ok: false, detail: `${dev.name} (${dev.id}): no ${t.cascadeTier} shards`, minConsecutive: 1 }
      }
      const lag = now - mx
      const ok = lag <= t.cascadeMaxLagMs
      return { id, ok, detail: `${dev.name} (${dev.id}): ${t.cascadeTier} newest close ${humanDuration(lag)} ago`, minConsecutive: 1 }
    } catch (e) {
      return { id, ok: false, detail: `${dev.name} (${dev.id}): cascade-lag query failed — ${(e as Error).message}`, minConsecutive: 1 }
    }
  }))
}

/** Serve availability: probe one coarse-budget 7d query (the tier=None
 *  fragile path) for the first device; fail if it errors or returns an
 *  empty plan. Gated by `serveEmptyMinConsecutive` so a benign sub-minute
 *  D1-read transient does not page. */
async function checkServeEmpty(
  env: MonitorEnv, devices: Device[], now: number, t: HealthThresholds,
): Promise<CheckResult | null> {
  // Prefer the service binding (direct worker-to-worker); fall back to a
  // public URL. A bare `fetch()` to the sibling workers.dev host loops back
  // to this worker, so the binding is required for the probe to work.
  const base = env.SERVE !== undefined ? 'https://serve' : env.SERVE_URL?.replace(/\/$/, '')
  if (base === undefined || devices.length === 0) return null
  const dev = devices[0]!
  const id = `serve-empty:${dev.id}`
  const min = t.serveEmptyMinConsecutive
  const from = new Date(now - 7 * 86_400_000).toISOString()
  const to = new Date(now).toISOString()
  const url = `${base}/q?device_id=${dev.id}&bin_budget=800&from=${from}&to=${to}`
  try {
    const resp = env.SERVE !== undefined ? await env.SERVE.fetch(url) : await fetch(url)
    if (!resp.ok) {
      return { id, ok: false, detail: `${dev.name} (${dev.id}): serve HTTP ${resp.status}`, minConsecutive: min }
    }
    const body = await resp.json() as { plan?: { outputTier?: string | null } }
    const tier = body.plan?.outputTier ?? null
    const ok = tier !== null
    return { id, ok, detail: `${dev.name} (${dev.id}): serve /q tier=${tier ?? 'None'}`, minConsecutive: min }
  } catch (e) {
    return { id, ok: false, detail: `${dev.name} (${dev.id}): serve probe failed — ${(e as Error).message}`, minConsecutive: min }
  }
}

async function readState(db: D1Database): Promise<Map<string, StateRow>> {
  const { results } = await db
    .prepare('SELECT check_id, failing, consecutive, alerted, since, detail, updated_at FROM health_state')
    .all<{ check_id: string; failing: number; consecutive: number; alerted: number; since: number | null; detail: string; updated_at: number }>()
  const map = new Map<string, StateRow>()
  for (const r of results) {
    map.set(r.check_id, {
      checkId: r.check_id, failing: r.failing === 1, consecutive: r.consecutive,
      alerted: r.alerted === 1, since: r.since, detail: r.detail, updatedAt: r.updated_at,
    })
  }
  return map
}

async function writeState(db: D1Database, rows: StateRow[]): Promise<void> {
  if (rows.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO health_state (check_id, failing, consecutive, alerted, since, detail, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(check_id) DO UPDATE SET
       failing = excluded.failing, consecutive = excluded.consecutive,
       alerted = excluded.alerted, since = excluded.since,
       detail = excluded.detail, updated_at = excluded.updated_at`,
  )
  await db.batch(rows.map(r => stmt.bind(
    r.checkId, r.failing ? 1 : 0, r.consecutive, r.alerted ? 1 : 0, r.since, r.detail, r.updatedAt,
  )))
}

async function sendPushover(env: MonitorEnv, alerts: Alert[]): Promise<void> {
  if (alerts.length === 0) return
  if (env.PUSHOVER_TOKEN === undefined || env.PUSHOVER_USER === undefined) {
    console.warn(`health: ${alerts.length} alert(s) but Pushover creds unset — skipping send`, alerts.map(a => `${a.kind} ${a.checkId}`))
    return
  }
  const down = alerts.filter(a => a.kind === 'down')
  const title = down.length > 0 ? `⚠️ awair pyrmts: ${down.length} down` : `✅ awair pyrmts: recovered`
  const message = alerts.map(a => `${a.kind === 'down' ? '🔴' : '🟢'} ${a.checkId} — ${a.detail}`).join('\n')
  // Higher priority when something is down.
  const priority = down.length > 0 ? '1' : '0'
  try {
    const resp = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: env.PUSHOVER_TOKEN, user: env.PUSHOVER_USER,
        title, message, priority,
      }),
    })
    if (!resp.ok) console.error(`health: Pushover POST ${resp.status}: ${await resp.text()}`)
  } catch (e) {
    console.error('health: Pushover POST failed —', (e as Error).message)
  }
}

/**
 * One monitor pass: evaluate all checks, diff against persisted state,
 * persist the new state, and page Pushover for any transitions. Cheap
 * enough to run every cron tick. Never throws — logs and returns.
 */
export async function runHealthMonitor(env: MonitorEnv, now: number = Date.now()): Promise<void> {
  try {
    const t = thresholdsFrom(env)
    const devices = await readDevices(env.DB)
    const [rawTips, cascade, serve] = await Promise.all([
      checkRawTips(env, devices, now, t),
      checkCascadeLag(env, devices, now, t),
      checkServeEmpty(env, devices, now, t),
    ])
    const results: CheckResult[] = [...rawTips, ...cascade, ...(serve ? [serve] : [])]

    const prev = await readState(env.DB)
    const nextRows: StateRow[] = []
    const alerts: Alert[] = []
    for (const res of results) {
      const { next, alert } = transition(prev.get(res.id), res, now)
      nextRows.push(next)
      if (alert) alerts.push(alert)
    }
    await writeState(env.DB, nextRows)
    await sendPushover(env, alerts)

    // Durable telemetry: log every synthetic probe that hit the empty-plan
    // transient (independent of user traffic, ~1/min baseline). See
    // `events.ts` / migration `0007`. Best-effort — never blocks the tick.
    if (serve && !serve.ok) {
      const deviceId = Number.parseInt(serve.id.split(':')[1] ?? '', 10)
      await recordEvent(env.DB, {
        kind: 'probe_empty',
        deviceId: Number.isFinite(deviceId) ? deviceId : undefined,
        detail: serve.detail,
      }, now).catch(e => console.error('health: recordEvent(probe_empty) failed —', (e as Error).message))
    }

    const failing = results.filter(r => !r.ok)
    if (failing.length > 0 || alerts.length > 0) {
      console.log(JSON.stringify({
        health: { failing: failing.map(f => f.id), alerted: alerts.map(a => `${a.kind}:${a.checkId}`) },
      }))
    }
  } catch (e) {
    console.error('health: monitor pass failed —', (e as Error).message, (e as Error).stack)
  }
}
