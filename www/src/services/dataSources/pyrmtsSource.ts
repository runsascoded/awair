/**
 * Data source backed by the `awair-serve` Cloudflare Worker, which serves
 * pre-aggregated pyrmts pyramid shards from R2.
 *
 * The worker emits sum-monoid rows ({ts, device_id, {metric}_n, _sum, _sumsq}).
 * This adapter converts them to AwairRecords by computing per-metric mean
 * (sum / n). When `n === 0` for a metric, the field is NaN (chart skips).
 */

import type { AwairRecord } from '../../types/awair'
import type { DataSource, FetchOptions, FetchResult } from '../dataSource'

const DEFAULT_PYRMTS_URL = 'https://awair-serve.ryan-0dc.workers.dev/q'

// For phase 3 A/B: request raw-equivalent density. Phase 4 will pass the
// actual chart container px width and remove the client-side re-aggregation.
const DEFAULT_BIN_BUDGET = 50_000

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
    segments: Array<{ tier: string; from: string; to: string; reaggregate: boolean; keys: string[] }>
  }
}

function pyramidUrl(): string {
  const env = (import.meta.env as Record<string, string | undefined>).VITE_PYRMTS_URL
  return env ?? DEFAULT_PYRMTS_URL
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
  }
  return out
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
    url.searchParams.set('bin_budget', String(DEFAULT_BIN_BUDGET))

    const networkStart = performance.now()
    const resp = await fetch(url.toString())
    const networkEnd = performance.now()

    if (!resp.ok) {
      const body = await resp.text()
      throw new Error(`PyrmtsSource: ${resp.status} ${resp.statusText} — ${body}`)
    }

    // Capture bytes from content-length if present; otherwise estimate from text length
    const contentLength = resp.headers.get('content-length')
    const text = await resp.text()
    const bytesTransferred = contentLength ? Number.parseInt(contentLength, 10) : new TextEncoder().encode(text).byteLength

    const body = JSON.parse(text) as PyramidResponse
    const records = body.records.map(pyramidRowToAwairRecord)

    const t1 = performance.now()

    console.log(
      `[${opts.deviceId}] pyrmts: tier=${body.plan.outputTier} bin=${body.plan.outputBin} ` +
        `records=${records.length} bytes=${bytesTransferred} segments=${body.plan.segments.map(s => `${s.tier}[${s.keys.length}]`).join(',')}`,
    )

    return {
      records,
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
