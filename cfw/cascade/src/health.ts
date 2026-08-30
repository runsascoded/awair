// Cascade-hosted health monitor + Pushover alerting.
//
// Runs each cron tick (cheap: one R2 HEAD + one D1 read per device, plus
// an optional cross-worker serve probe), evaluates a fixed set of checks,
// and pages via Pushover on healthy↔unhealthy *transitions* — deduped
// through the `health_state` D1 table, so a sustained outage pages once
// (and once on recovery), not every minute.
//
// Why these checks (see `specs/…` / session notes 2026-08-30):
//  - `raw-tip`     — Lambda liveness. The per-minute raw 1d tip is the
//                    freshness source the serve re-aggregates every open
//                    tail from; if it stalls, everything downstream is
//                    stale even though stored coarse shards look fine.
//  - `cascade-lag` — cascade liveness. The finest aggregate tier (`m10`,
//                    1d rung) should close daily; a growing lag means the
//                    converge loop is stuck (distinct from Lambda health).
//  - `serve-empty` — the actual user-visible failure mode: the serve
//                    returning an empty plan (`tier=null`) for a query a
//                    device *has* data for. Gated by `minConsecutive` so a
//                    rare sub-minute transient (benign, self-healing) does
//                    not page — only a sustained regression does.
//
// The coarse-tier "staleness" that looks alarming in raw inventory
// (`d1` 23d, `h2/h6` 7d) is the immutable-closed-shard ladder cadence,
// NOT a fault: the serve bridges every open tail from the raw tip. So we
// deliberately do NOT alert on stored coarse-shard age.

export interface HealthThresholds {
  // Lambda down if the current-day raw tip is older than this. Default 5min.
  rawTipMaxAgeMs: number
  // Cascade stalled if the finest aggregate tier's newest shard is older
  // than this. `m10`'s 1d rung closes daily, so normal lag is <~1.5d.
  // Default 2d.
  cascadeMaxLagMs: number
  // Aggregate tier whose freshness tracks cascade liveness.
  cascadeTier: string
  // Consecutive failing ticks before `serve-empty` pages. Default 3
  // (≈3 min) — rides out the benign sub-minute D1-read transient.
  serveEmptyMinConsecutive: number
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  rawTipMaxAgeMs: 5 * 60_000,
  cascadeMaxLagMs: 2 * 86_400_000,
  cascadeTier: 'm10',
  serveEmptyMinConsecutive: 3,
}

/** One evaluated check for one tick. `minConsecutive` lets a check demand
 *  a sustained failure streak before it's allowed to page. */
export interface CheckResult {
  id: string
  ok: boolean
  detail: string
  minConsecutive: number
}

/** Persisted per-check state (one `health_state` row). */
export interface StateRow {
  checkId: string
  failing: boolean
  consecutive: number   // consecutive failing ticks (0 when ok)
  alerted: boolean      // have we already paged for the current failing streak?
  since: number | null  // ms ts the current failing streak began
  detail: string
  updatedAt: number
}

export type AlertKind = 'down' | 'recovered'

export interface Alert {
  kind: AlertKind
  checkId: string
  detail: string
}

/**
 * Pure transition: given a check's previous persisted state and this
 * tick's result, compute the next state and whether to page.
 *
 *  - Page `down` on the tick where a failing streak first reaches the
 *    check's `minConsecutive` (and we haven't paged for this streak yet).
 *  - Page `recovered` on the first ok tick after we'd paged `down`.
 *  - Never page twice for one streak; never page recovery we didn't warn.
 */
export function transition(
  prev: StateRow | undefined,
  res: CheckResult,
  now: number,
): { next: StateRow; alert?: Alert } {
  if (res.ok) {
    const wasAlerted = prev?.alerted ?? false
    const next: StateRow = {
      checkId: res.id, failing: false, consecutive: 0, alerted: false,
      since: null, detail: res.detail, updatedAt: now,
    }
    return wasAlerted
      ? { next, alert: { kind: 'recovered', checkId: res.id, detail: res.detail } }
      : { next }
  }

  const consecutive = (prev?.failing ? prev.consecutive : 0) + 1
  const since = prev?.failing ? (prev.since ?? now) : now
  const alreadyAlerted = prev?.alerted ?? false
  const shouldAlert = !alreadyAlerted && consecutive >= res.minConsecutive
  const next: StateRow = {
    checkId: res.id, failing: true, consecutive,
    alerted: alreadyAlerted || shouldAlert, since,
    detail: res.detail, updatedAt: now,
  }
  return shouldAlert
    ? { next, alert: { kind: 'down', checkId: res.id, detail: res.detail } }
    : { next }
}

/** Human-readable ms duration, e.g. `2m 3s`, `1d 4h`, `45s`. */
export function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** UTC `YYYY-MM-DD` for an ms timestamp (raw tip period label). */
export function utcDayLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
