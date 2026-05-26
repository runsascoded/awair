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
    outputTier: string
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

    const networkStart = performance.now()
    const resp = await fetch(url.toString())
    const networkEnd = performance.now()

    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`PyrmtsSource: ${resp.status} ${resp.statusText} — ${body}`)
    }

    const contentLength = resp.headers.get('content-length')
    const text = await resp.text()
    const bytesTransferred = contentLength ? Number.parseInt(contentLength, 10) : new TextEncoder().encode(text).byteLength

    const body = JSON.parse(text) as PyramidResponse
    const records = body.records.map(pyramidRowToAwairRecord)

    const t1 = performance.now()

    const smoothInfo = body.plan.smoothing
      ? ` smooth=${body.plan.smoothing.smoothBin}(${body.plan.smoothing.smoothBinCount}×${body.plan.outputBin}, ${body.plan.smoothing.smoothMode})`
      : ''
    console.log(
      `[${opts.deviceId}] pyrmts: tier=${body.plan.outputTier} bin=${body.plan.outputBin}${smoothInfo} ` +
        `records=${records.length} bytes=${bytesTransferred} segments=${body.plan.segments.map(s => `${s.tier}[${s.keys.length}]`).join(',')}`,
    )

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
