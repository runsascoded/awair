/**
 * Data source backed by the `awair-serve` Cloudflare Worker, which serves
 * pre-aggregated pyrmts pyramid shards from R2.
 *
 * The worker emits sum-monoid rows ({ts, device_id, {metric}_n, _sum, _sumsq}).
 * This adapter converts them to AwairRecords by computing per-metric mean
 * (sum / n). When `n === 0` for a metric, the field is NaN (chart skips).
 *
 * If the caller passes `smoothing`, the worker returns parallel
 * `{metric}_smooth_n/_sum/_sumsq` columns; we surface those as
 * `<metric>_smooth` (mean) + `<metric>_smooth_stddev` on each record.
 */

import type { AwairRecord } from '../../types/awair'
import type { DataSource, FetchOptions, FetchResult } from '../dataSource'

const { sqrt, max } = Math

const DEFAULT_PYRMTS_URL = 'https://awair-serve.ryan-0dc.workers.dev/q'

// Fallback bin budget if the caller doesn't pass one. Generous so we don't
// silently over-aggregate at typical chart widths.
const DEFAULT_BIN_BUDGET = 4_000

const METRICS = ['temp', 'co2', 'pm10', 'pm25', 'humid', 'voc'] as const

interface PyramidRow {
  ts: number
  device_id: number
  [stateCol: string]: number
}

interface PyramidResponse {
  records: PyramidRow[]
  plan: {
    // Absent when the planner found no in-budget tier with coverage
    // (empty plan). See the retry in `fetch()`.
    outputTier?: string
    outputBin: string
    authoritativeEnd: string | null
    smoothing?: {
      smoothBin: string
      smoothBinCount: number
      smoothMode: 'centered' | 'trailing'
      smoothSourceTier: string
    }
    segments: Array<{ tier: string; from: string; to: string; reaggregate: boolean; keys: string[] }>
  }
}

function pyramidUrl(): string {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_PYRMTS_URL
  return env ?? DEFAULT_PYRMTS_URL
}

// Telemetry sink (the cascade worker's `/event`). Records the empty-plan
// transient + fetch errors durably in D1 for later frequency analysis
// (see `cfw/cascade/src/events.ts`). Fire-and-forget via `sendBeacon`, so
// it never blocks or fails a fetch.
const DEFAULT_TELEMETRY_URL = 'https://awair-cascade.ryan-0dc.workers.dev/event'
function telemetryUrl(): string {
  return (import.meta.env as Record<string, string | undefined>).VITE_TELEMETRY_URL ?? DEFAULT_TELEMETRY_URL
}
function beacon(payload: Record<string, unknown>): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
    // text/plain Blob keeps this a CORS "simple request" (no preflight).
    navigator.sendBeacon(telemetryUrl(), new Blob([JSON.stringify(payload)], { type: 'text/plain' }))
  } catch {
    // Telemetry must never affect the app.
  }
}

/**
 * sum-monoid stddev. `n` is sample count, so unbiased stddev divides by `n - 1`;
 * use plain population stddev (divide by n) for our display purposes.
 * Guard against tiny negative residuals from floating-point.
 */
function popStddev(n: number, sum: number, sumsq: number): number {
  if (n <= 0) return NaN
  const mean = sum / n
  const variance = max(0, sumsq / n - mean * mean)
  return sqrt(variance)
}

export function pyramidRowToAwairRecord(row: PyramidRow): AwairRecord {
  const out: AwairRecord = {
    timestamp: new Date(row.ts),
    temp: NaN,
    co2: NaN,
    pm10: NaN,
    pm25: NaN,
    humid: NaN,
    voc: NaN,
  }
  for (const m of METRICS) {
    const n = row[`${m}_n`]
    const sum = row[`${m}_sum`]
    if (n !== undefined && sum !== undefined && n > 0) {
      out[m] = sum / n
    }
    const sn = row[`${m}_smooth_n`]
    const ssum = row[`${m}_smooth_sum`]
    const ssumsq = row[`${m}_smooth_sumsq`]
    if (sn !== undefined && ssum !== undefined && sn > 0) {
      out[`${m}_smooth` as const] = ssum / sn
      if (ssumsq !== undefined) {
        out[`${m}_smooth_stddev` as const] = popStddev(sn, ssum, ssumsq)
      }
    }
  }
  return out
}

/** Render a smoothing setting as the `?smooth=` query-string value the worker expects. */
function encodeSmoothing(s: FetchOptions['smoothing']): string | null {
  if (s === undefined || s === null) return null
  if (typeof s === 'string') return s   // 'auto', 'auto25', '4h', etc — passed through
  if (typeof s === 'number') {
    if (s === 0) return 'auto'           // sentinel "auto" — worker picks ~50× bin
    if (s <= 1) return null              // sentinel "off"
    return `${s}min`                     // minutes → server's Duration syntax
  }
  return null
}

export class PyrmtsSource implements DataSource {
  readonly type = 'pyrmts-cfw' as const
  readonly name = 'Cloudflare Worker (pyrmts)'

  async fetch(opts: FetchOptions): Promise<FetchResult> {
    const t0 = performance.now()

    const url = new URL(pyramidUrl())
    url.searchParams.set('from', opts.range.from.toISOString())
    url.searchParams.set('to', opts.range.to.toISOString())
    url.searchParams.set('device_id', String(opts.deviceId))
    url.searchParams.set('bin_budget', String(opts.binBudget ?? DEFAULT_BIN_BUDGET))
    const smoothParam = encodeSmoothing(opts.smoothing)
    if (smoothParam !== null) url.searchParams.set('smooth', smoothParam)

    // The serve worker very occasionally returns an empty plan
    // (`outputTier` absent, 0 records) for a device that has data — the
    // signature of a transient D1-inventory read that momentarily drops
    // the aggregate tiers, leaving only the over-budget raw rows so no
    // in-budget tier has coverage. It self-heals within ~a second, so
    // retry a few times before surfacing an empty result, which would
    // otherwise render the "No data" state on an initial / new-device
    // load. See session notes 2026-08-30 + the cascade `serve-empty`
    // health check. (A genuinely-empty range costs a few short retries
    // then falls through — an acceptable trade for the rare case.)
    // Common telemetry fields for this query (see `beacon`).
    const evBase = {
      deviceId: opts.deviceId,
      binBudget: opts.binBudget ?? DEFAULT_BIN_BUDGET,
      rangeFrom: opts.range.from.getTime(),
      rangeTo: opts.range.to.getTime(),
      ...(smoothParam !== null ? { smooth: smoothParam } : {}),
    }

    const RETRY_DELAYS_MS = [300, 600, 1200]
    let networkStart = 0
    let networkEnd = 0
    let bytesTransferred = 0
    let body!: PyramidResponse
    let records!: FetchResult['records']
    let emptyAttempts = 0
    for (let attempt = 0; ; attempt++) {
      networkStart = performance.now()
      let resp: Response
      try {
        resp = await fetch(url.toString())
      } catch (e) {
        beacon({ kind: 'client_error', ...evBase, status: 0, detail: (e as Error).message })
        throw e
      }
      networkEnd = performance.now()

      if (!resp.ok) {
        const errText = await resp.text()
        beacon({ kind: 'client_error', ...evBase, status: resp.status, detail: `${resp.statusText} — ${errText}`.slice(0, 500) })
        throw new Error(`PyrmtsSource: ${resp.status} ${resp.statusText} — ${errText}`)
      }

      const contentLength = resp.headers.get('content-length')
      const text = await resp.text()
      bytesTransferred = contentLength ? Number.parseInt(contentLength, 10) : new TextEncoder().encode(text).byteLength

      body = JSON.parse(text) as PyramidResponse
      records = body.records.map(pyramidRowToAwairRecord)

      const emptyPlan = body.plan.outputTier == null && records.length === 0
      if (!emptyPlan) break
      emptyAttempts++
      if (attempt >= RETRY_DELAYS_MS.length) break
      console.warn(`[${opts.deviceId}] pyrmts: empty plan (tier=None) — transient, retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${RETRY_DELAYS_MS[attempt]}ms`)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
    // Record the transient (once per fetch that saw ≥1 empty attempt),
    // noting whether a retry recovered.
    if (emptyAttempts > 0) {
      beacon({ kind: 'client_empty', ...evBase, attempts: emptyAttempts, recovered: records.length > 0 })
    }

    const t1 = performance.now()

    const smoothInfo = body.plan.smoothing
      ? ` smooth=${body.plan.smoothing.smoothBin}(${body.plan.smoothing.smoothBinCount}×${body.plan.outputBin}, ${body.plan.smoothing.smoothMode})`
      : ''
    const line = `[${opts.deviceId}] pyrmts: tier=${body.plan.outputTier ?? 'None'} bin=${body.plan.outputBin}${smoothInfo} ` +
      `records=${records.length} bytes=${bytesTransferred} segments=${body.plan.segments.map(s => `${s.tier}[${s.keys.length}]`).join(',')}`
    // `records=0` from a successful fetch means the tier shard is empty/missing
    // for the requested range — surface as a warning so it stands out in the
    // console. This is the signature of a stale pyrmts upper-tier backfill.
    if (records.length === 0) console.warn(line + ' ⚠️ empty shard')
    else console.log(line)

    const lastModified = body.plan.authoritativeEnd
      ? new Date(body.plan.authoritativeEnd)
      : undefined

    return {
      records,
      lastModified,
      timing: {
        totalMs: t1 - t0,
        networkMs: networkEnd - networkStart,
        parseMs: t1 - networkEnd,
        bytesTransferred,
        source: this.type,
      },
    }
  }
}
