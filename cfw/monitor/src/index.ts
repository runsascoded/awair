/**
 * Awair device freshness monitor.
 *
 * Runs every minute via cron, HEADs each device's current-UTC-month parquet
 * file in S3, and sends a Pushover alert when staleness crosses a tier
 * boundary (5min, 15min, 60min, then every +60min). One recovery alert is
 * sent when a previously-alerted device returns to <5min stale.
 */

interface Device {
  id: number
  name: string
}

interface DeviceState {
  /** Highest tier (minutes) at which we've alerted in the current stale stretch. 0 = no alert sent yet. */
  lastAlertedTier: number
  /** Timestamp (ms) of the most recent data point seen — used to compute "stale for X". */
  firstStaleAt: number
}

interface Env {
  STATE: KVNamespace
  PUSHOVER_TOKEN: string
  PUSHOVER_USER: string
  S3_BUCKET: string
  CHART_URL: string
  DEVICES_JSON: string
  MANUAL_CHECK_KEY?: string
}

const FRESH_THRESHOLD_MIN = 5
const TIERS_MIN = [5, 15, 60]

/**
 * Cadence between alerts scales up with staleness — a multi-day outage
 * shouldn't page every hour. Whichever entry has the largest `minTier`
 * ≤ prevTier wins.
 */
const BACKOFF_BANDS: ReadonlyArray<{ minTier: number; cadenceMin: number }> = [
  { minTier: 60,          cadenceMin: 60 },       // 1h..6h:  +1h
  { minTier: 6 * 60,      cadenceMin: 2 * 60 },   // 6h..24h: +2h
  { minTier: 24 * 60,     cadenceMin: 6 * 60 },   // 1d..7d:  +6h
  { minTier: 7 * 24 * 60, cadenceMin: 24 * 60 },  // 7d+:     +1d
]

/** Wait this many minutes after UTC month rollover before treating a missing current-month file as "stale" rather than "Lambda hasn't created it yet". */
const NEW_MONTH_GRACE_MIN = 5

function cadenceForTier(prevTier: number): number {
  let cadence = BACKOFF_BANDS[0].cadenceMin
  for (const b of BACKOFF_BANDS) {
    if (prevTier >= b.minTier) cadence = b.cadenceMin
  }
  return cadence
}

function nextTier(prevTier: number): number {
  for (const t of TIERS_MIN) {
    if (prevTier < t) return t
  }
  return prevTier + cadenceForTier(prevTier)
}

function currentUTCMonth(now: Date): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function prevUTCMonth(now: Date): string {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const prev = new Date(Date.UTC(y, m - 1, 1))
  return currentUTCMonth(prev)
}

function monthStartUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

function humanDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  const days = Math.floor(totalMin / 1440)
  const hours = Math.floor((totalMin % 1440) / 60)
  const mins = totalMin % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (mins || parts.length === 0) parts.push(`${mins}m`)
  return parts.join(' ')
}

interface HeadResult {
  lastMod: Date | null
  status: 'ok' | 'no-file-yet' | 'no-data'
}

/**
 * Resolve the most-recent parquet `Last-Modified` for a device.
 *
 * Tries the current UTC month first. If 404 and we're within NEW_MONTH_GRACE_MIN
 * of UTC midnight, returns `no-file-yet` (don't alert — the Lambda just hasn't
 * created the new month's file). Otherwise falls back to the previous month.
 */
async function getLastModified(env: Env, deviceId: number, now: Date): Promise<HeadResult> {
  const current = currentUTCMonth(now)
  const currentUrl = `https://${env.S3_BUCKET}.s3.amazonaws.com/awair-${deviceId}/${current}.parquet`

  const resp = await fetch(currentUrl, { method: 'HEAD' })
  if (resp.ok) {
    const h = resp.headers.get('last-modified')
    return { lastMod: h ? new Date(h) : null, status: 'ok' }
  }
  if (resp.status !== 404) {
    throw new Error(`HEAD ${currentUrl}: ${resp.status}`)
  }

  // Current month 404 — check whether we're in the rollover grace window.
  const sinceMonthStartMs = now.getTime() - monthStartUTC(now)
  if (sinceMonthStartMs < NEW_MONTH_GRACE_MIN * 60_000) {
    return { lastMod: null, status: 'no-file-yet' }
  }

  // Past the grace window — try previous month for a baseline.
  const prev = prevUTCMonth(now)
  const prevUrl = `https://${env.S3_BUCKET}.s3.amazonaws.com/awair-${deviceId}/${prev}.parquet`
  const prevResp = await fetch(prevUrl, { method: 'HEAD' })
  if (prevResp.ok) {
    const h = prevResp.headers.get('last-modified')
    return { lastMod: h ? new Date(h) : null, status: 'ok' }
  }
  return { lastMod: null, status: 'no-data' }
}

async function sendPushover(
  env: Env,
  opts: { title: string; message: string; url?: string; priority?: number },
): Promise<void> {
  const body = new URLSearchParams({
    token: env.PUSHOVER_TOKEN,
    user: env.PUSHOVER_USER,
    title: opts.title,
    message: opts.message,
  })
  if (opts.url) body.set('url', opts.url)
  if (opts.priority !== undefined) body.set('priority', String(opts.priority))

  const resp = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Pushover ${resp.status}: ${text}`)
  }
}

interface CheckResult {
  id: number
  name: string
  status: string
  staleMin: number | null
  alertedTier?: number
}

async function checkDevice(env: Env, device: Device, nowMs: number): Promise<CheckResult> {
  const now = new Date(nowMs)
  const stateKey = `device:${device.id}`

  let head: HeadResult
  try {
    head = await getLastModified(env, device.id, now)
  } catch (e) {
    return { id: device.id, name: device.name, status: `head-error: ${(e as Error).message}`, staleMin: null }
  }

  if (head.status === 'no-file-yet') {
    return { id: device.id, name: device.name, status: 'no-file-yet', staleMin: null }
  }

  const stateJson = await env.STATE.get(stateKey)
  const state: DeviceState = stateJson
    ? JSON.parse(stateJson)
    : { lastAlertedTier: 0, firstStaleAt: 0 }

  if (head.status === 'no-data' || head.lastMod === null) {
    // No data files at all — treat as stale relative to month start
    const synthetic = monthStartUTC(now)
    const staleMin = Math.floor((nowMs - synthetic) / 60_000)
    if (state.firstStaleAt === 0) state.firstStaleAt = synthetic
    const tier = nextTier(state.lastAlertedTier)
    if (staleMin >= tier) {
      await sendPushover(env, {
        title: `⚠️ ${device.name}: no data file`,
        message: `No parquet found for ${device.name} this month or last. Stale ${humanDuration(nowMs - synthetic)}.`,
        url: env.CHART_URL,
        priority: 1,
      })
      state.lastAlertedTier = tier
      await env.STATE.put(stateKey, JSON.stringify(state))
      return { id: device.id, name: device.name, status: 'alerted-no-data', staleMin, alertedTier: tier }
    }
    if (stateJson === null) await env.STATE.put(stateKey, JSON.stringify(state))
    return { id: device.id, name: device.name, status: 'no-data-below-tier', staleMin }
  }

  const staleMin = Math.floor((nowMs - head.lastMod.getTime()) / 60_000)

  if (staleMin < FRESH_THRESHOLD_MIN) {
    if (state.lastAlertedTier > 0) {
      const downtime = humanDuration(nowMs - state.firstStaleAt)
      await sendPushover(env, {
        title: `✅ ${device.name} recovered`,
        message: `${device.name} is reporting again after ${downtime} stale.`,
        url: env.CHART_URL,
      })
      await env.STATE.delete(stateKey)
      return { id: device.id, name: device.name, status: 'recovered', staleMin }
    }
    return { id: device.id, name: device.name, status: 'fresh', staleMin }
  }

  let shouldPersist = false
  if (state.firstStaleAt === 0) {
    state.firstStaleAt = head.lastMod.getTime()
    shouldPersist = true
  }

  const tier = nextTier(state.lastAlertedTier)
  if (staleMin >= tier) {
    const downtime = humanDuration(nowMs - state.firstStaleAt)
    await sendPushover(env, {
      title: `⚠️ ${device.name} stale ${downtime}`,
      message: `No new data from ${device.name} for ${downtime}.\nLast update: ${head.lastMod.toISOString()}`,
      url: env.CHART_URL,
      priority: 1,
    })
    state.lastAlertedTier = tier
    shouldPersist = true
  }

  if (shouldPersist) await env.STATE.put(stateKey, JSON.stringify(state))

  return {
    id: device.id,
    name: device.name,
    status: staleMin >= tier ? `alerted-${tier}m` : 'stale-below-tier',
    staleMin,
    alertedTier: staleMin >= tier ? tier : undefined,
  }
}

async function checkAll(env: Env): Promise<{ now: string; results: CheckResult[] }> {
  const nowMs = Date.now()
  const devices: Device[] = JSON.parse(env.DEVICES_JSON)
  const results = await Promise.all(devices.map(d => checkDevice(env, d, nowMs)))
  return { now: new Date(nowMs).toISOString(), results }
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      checkAll(env)
        .then(r => console.log(JSON.stringify(r)))
        .catch(e => console.error('checkAll failed:', e)),
    )
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/check') {
      if (env.MANUAL_CHECK_KEY) {
        const key = url.searchParams.get('key')
        if (key !== env.MANUAL_CHECK_KEY) {
          return new Response('forbidden\n', { status: 403 })
        }
      }
      try {
        const result = await checkAll(env)
        return new Response(JSON.stringify(result, null, 2) + '\n', {
          headers: { 'content-type': 'application/json' },
        })
      } catch (e) {
        return new Response(`error: ${(e as Error).message}\n`, { status: 500 })
      }
    }

    if (url.pathname === '/test-pushover') {
      if (env.MANUAL_CHECK_KEY) {
        const key = url.searchParams.get('key')
        if (key !== env.MANUAL_CHECK_KEY) {
          return new Response('forbidden\n', { status: 403 })
        }
      }
      try {
        await sendPushover(env, {
          title: '🧪 awair-monitor test',
          message: 'Pushover wiring is working.',
        })
        return new Response('sent\n')
      } catch (e) {
        return new Response(`error: ${(e as Error).message}\n`, { status: 500 })
      }
    }

    return new Response('awair-monitor: GET /check, /test-pushover (both gated by ?key= if MANUAL_CHECK_KEY is set)\n', { status: 404 })
  },
}
