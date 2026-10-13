import { parquetReadObjects } from 'hyparquet'
import { invalidate } from 'pyrmts'
import { r2Storage } from 'pyrmts-cfw'
import { parseSnapshot, sourcePrefix, type RawSourceSnapshot } from '../../shared/raw-source'
import type { Device } from './devices'
import { makePyramid } from './pyramid'
import { coarsen, encodeShard, METRIC_NAMES, type AwairRow } from './rows'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const MAX_SOURCE_BYTES = 16 * 1024 * 1024
export const DEFAULT_SOURCE_ROOT = 'https://380nwk.s3.amazonaws.com'

/** Convert the authoritative S3 raw schema to sparse minute-bin monoid rows. */
export function sourceRows(
  source: Record<string, unknown>[],
  device: Device,
  start: number,
  end: number,
): AwairRow[] {
  const rows = source.map(r => {
    const timestamp = r.timestamp
    if (!(timestamp instanceof Date) && typeof timestamp !== 'string') {
      throw new Error('Raw source timestamp must be a Date or ISO string')
    }
    const ts = new Date(timestamp).getTime()
    if (!Number.isFinite(ts) || ts < start || ts >= end) throw new Error('Raw source timestamp outside month')
    const row: AwairRow = { ts, device_id: device.id }
    for (const metric of METRIC_NAMES) {
      if (!(metric in r)) throw new Error(`Raw source missing ${metric}`)
      const value = r[metric]
      if (value !== null && typeof value !== 'number' && typeof value !== 'bigint') {
        throw new Error(`Invalid raw source ${metric}`)
      }
      const n = value === null ? null : Number(value)
      if (n !== null && !Number.isFinite(n)) throw new Error(`Invalid raw source ${metric}`)
      row[`${metric}_n`] = n === null ? 0 : 1
      row[`${metric}_sum`] = n ?? 0
      row[`${metric}_sumsq`] = n === null ? 0 : n * n
    }
    return row
  }).filter(r => r.ts >= device.genesisDate.getTime())
  return coarsen(rows, MINUTE_MS, device.id)
}

/** Gaps of at least five minute bins; smaller sampling jitter stays out of health. */
export function dataGaps(rows: AwairRow[], start: number, end: number) {
  const gaps: Array<{ start: number; end: number }> = []
  let next = Math.ceil(start / MINUTE_MS) * MINUTE_MS
  for (const row of rows) {
    if (row.ts - next >= 5 * MINUTE_MS) gaps.push({ start: next, end: row.ts })
    next = row.ts + MINUTE_MS
  }
  if (end - next >= 5 * MINUTE_MS) gaps.push({ start: next, end })
  return gaps
}

export interface ReconcileOpts {
  r2: R2Bucket
  device: Device
  month: string
  now: Date
  deadline: number
  sourceRoot: string
  /** Repair a missing daily object even if a previous snapshot has the same ETag. */
  repair?: boolean
}

/**
 * Reconcile only a CLOSED calendar month. An absent/failed S3 fetch never
 * counts as empty input. A valid zero-row daily object explicitly records
 * processed-but-empty input, allowing the existing completeness gate to stand.
 * The ETag is evidence for this source version, not a claim that future repairs
 * are impossible. Journal invalidation precedes writes and completion evidence.
 */
export async function reconcileMonth(opts: ReconcileOpts): Promise<boolean> {
  const { r2, device, month, now, deadline, sourceRoot, repair } = opts
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Invalid month ${month}`)
  const start = Date.parse(`${month}-01T00:00:00Z`)
  const next = new Date(start)
  next.setUTCMonth(next.getUTCMonth() + 1)
  const end = next.getTime()
  if (end > now.getTime() || end <= device.genesisDate.getTime()) return false
  const key = `${sourcePrefix(device.id)}${month}.json`
  const previous = await r2.get(key)
  const snapshot = previous === null ? null : parseSnapshot(await previous.json())
  const sourceUrl = `${sourceRoot.replace(/\/$/, '')}/awair-${device.id}/${month}.parquet`
  if (Date.now() >= deadline) return false
  const response = await fetch(sourceUrl, {
    headers: !repair && snapshot?.sourceUrl === sourceUrl ? { 'If-None-Match': snapshot.sourceEtag } : {},
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  })
  if (response.status === 304 && snapshot !== null) return true
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Raw source ${month}: HTTP ${response.status}`)
  const sourceEtag = response.headers.get('etag')
  if (sourceEtag === null) throw new Error(`Raw source ${month}: missing ETag`)
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) throw new Error('Raw source too large')
  if (response.body === null) throw new Error('Raw source has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_SOURCE_BYTES) {
      await reader.cancel()
      throw new Error('Raw source too large')
    }
    chunks.push(value)
  }
  const bytes = new ArrayBuffer(size)
  const buffer = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }
  const source = await parquetReadObjects({ file: bytes }) as Record<string, unknown>[]
  const rows = sourceRows(source, device, start, end)
  const effectiveStart = Math.max(start, device.genesisDate.getTime())
  const storage = r2Storage(r2)
  const pyramid = makePyramid(r2)
  const days: number[] = []
  for (let day = Math.floor(effectiveStart / DAY_MS) * DAY_MS; day < end; day += DAY_MS) days.push(day)
  const dailyKeys = days.map(day => `pyramid/awair-${device.id}/raw/1d/${new Date(day).toISOString().slice(0, 10)}.parquet`)
  // At most 31 independent HEADs. Serial R2 latency can otherwise consume
  // the entire tick even when every daily tile has already been repaired.
  const existingDays = await Promise.all(dailyKeys.map(dailyKey => r2.head(dailyKey)))
  let changed = false
  for (const [index, day] of days.entries()) {
    if (Date.now() >= deadline) return false
    const dailyKey = dailyKeys[index]!
    const existing = existingDays[index]
    if (existing?.customMetadata?.source_etag === sourceEtag && existing.customMetadata.source_url === sourceUrl) continue
    if (!changed) {
      await invalidate(pyramid, storage, [new Date(effectiveStart), new Date(end)])
      changed = true
    }
    const dailyRows = rows.filter(r => r.ts >= day && r.ts < day + DAY_MS)
    await r2.put(dailyKey, encodeShard(dailyRows), {
      customMetadata: { source_etag: sourceEtag, source_url: sourceUrl, rows: String(dailyRows.length) },
    })
  }
  if (changed) await invalidate(pyramid, storage, [new Date(effectiveStart), new Date(end)])
  const completed: RawSourceSnapshot = {
    version: 1, month, sourceUrl, sourceEtag, reconciledAt: Date.now(),
    start: effectiveStart, end, rows: rows.length, gaps: dataGaps(rows, effectiveStart, end),
  }
  await r2.put(key, JSON.stringify(completed), { httpMetadata: { contentType: 'application/json' } })
  return true
}

/** Recheck one known source per device/tick, rotating to catch historical repairs. */
export async function auditSource(opts: Omit<ReconcileOpts, 'month'>): Promise<void> {
  const keys: string[] = []
  let cursor: string | undefined
  do {
    const page = await opts.r2.list({ prefix: sourcePrefix(opts.device.id), cursor })
    keys.push(...page.objects.map(o => o.key).filter(k => k.endsWith('.json')))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  if (keys.length === 0 || Date.now() >= opts.deadline) return
  const key = keys[Math.floor(opts.now.getTime() / MINUTE_MS) % keys.length]!
  const month = key.slice(sourcePrefix(opts.device.id).length, -5)
  await reconcileMonth({ ...opts, month })
}
