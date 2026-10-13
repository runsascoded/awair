import { afterEach, describe, expect, it, vi } from 'vitest'
import { ByteWriter, ParquetWriter, schemaFromColumnData } from 'hyparquet-writer'
import { parquetMetadata, parquetReadObjects } from 'hyparquet'
import { sourcePrefix, mergeGaps } from '../../shared/raw-source'
import { readDataGaps } from '../../serve/src/raw-source-health'
import { dataGaps, reconcileMonth, sourceRows } from './reconcile'
import { coarsen, encodeShard, METRIC_NAMES, readSourceShard } from './rows'
import { PYRAMID_CONFIG } from './pyramid'
import { writeShard } from './write'

const start = Date.parse('2026-09-01T00:00:00Z')
const end = Date.parse('2026-10-01T00:00:00Z')
const minute = 60_000
const device = { id: 137496, name: 'BR', genesisDate: new Date(start) }
const journalKey = 'pyramid/awair-_invalidations.json'
const snapshotKey = `${sourcePrefix(device.id)}2026-09.json`
const dailyKey = (day: string) => `pyramid/awair-${device.id}/raw/1d/${day}.parquet`

function sourceRow(ts: number, value = 2): Record<string, unknown> {
  return { timestamp: new Date(ts), ...Object.fromEntries(METRIC_NAMES.map(m => [m, value])) }
}

function rawParquet(rows: Record<string, unknown>[]): Uint8Array {
  const columnData = [
    { name: 'timestamp', type: 'TIMESTAMP' as const, data: rows.map(r => r.timestamp) },
    ...METRIC_NAMES.map(name => ({ name, type: 'DOUBLE' as const, data: rows.map(r => r[name]) })),
  ]
  const writer = new ByteWriter()
  const parquet = new ParquetWriter({ writer, schema: schemaFromColumnData({ columnData }) })
  parquet.write({ columnData })
  parquet.finish()
  return new Uint8Array(writer.buffer, 0, writer.index)
}

/** Byte-level bucket exercising the real pyrmts invalidation CAS adapter. */
function bucket() {
  const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string>; etag: string }>()
  const writes: string[] = []
  const r2 = {
    async get(key: string) {
      const obj = objects.get(key)
      return obj === undefined ? null : {
        ...obj,
        arrayBuffer: async () => obj.bytes.slice().buffer,
        json: async () => JSON.parse(new TextDecoder().decode(obj.bytes)),
      }
    },
    async head(key: string) { return objects.get(key) ?? null },
    async put(key: string, body: Uint8Array | string, opts?: R2PutOptions) {
      const existing = objects.get(key)
      const condition = opts?.onlyIf as R2Conditional | undefined
      if (condition?.etagDoesNotMatch === '*' && existing !== undefined) return null
      if (condition?.etagMatches !== undefined && existing?.etag !== condition.etagMatches) return null
      writes.push(key)
      const obj = {
        bytes: typeof body === 'string' ? new TextEncoder().encode(body) : body.slice(),
        customMetadata: opts?.customMetadata,
        etag: String(writes.length),
      }
      objects.set(key, obj)
      return obj
    },
    async list(opts: R2ListOptions) {
      return { objects: [...objects.keys()].filter(key => key.startsWith(opts.prefix ?? '')).map(key => ({ key })), truncated: false }
    },
  } as unknown as R2Bucket
  return { r2, objects, writes }
}

function opts(r2: R2Bucket) {
  return { r2, device, month: '2026-09', now: new Date(end), deadline: Date.now() + 25_000, sourceRoot: 'https://source.example' }
}

function respond(rows: Record<string, unknown>[], etag = 'v1') {
  const fetch = vi.fn(async () => new Response(rawParquet(rows), { headers: { etag } }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('closed-month reconciliation', () => {
  it('finishes a closed month within the tick budget despite daily R2 read latency', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(end)
    const b = bucket()
    const source = [sourceRow(start), sourceRow(end - minute)]
    respond(source)
    const originalHead = b.r2.head.bind(b.r2)
    const originalGet = b.r2.get.bind(b.r2)
    vi.spyOn(b.r2, 'head').mockImplementation(async key => {
      await new Promise(resolve => setTimeout(resolve, 500))
      return originalHead(key)
    })
    vi.spyOn(b.r2, 'get').mockImplementation(async key => {
      if (key.startsWith(`pyramid/awair-${device.id}/raw/1d/`)) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      return originalGet(key)
    })
    const pending = writeShard({
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers[0]!, targetShardDur: '1mo',
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(end), effectiveStart: new Date(start), effectiveEnd: new Date(end),
    })
    await vi.runAllTimersAsync()
    const result = await pending
    expect({ status: result.status, rows: result.rows, inputsPresent: result.inputsPresent, inputsExpected: result.inputsExpected }).toEqual({
      status: 'wrote', rows: 2, inputsPresent: 30, inputsExpected: 30,
    })
  })

  it('stores known-empty days, keeps the outage sparse, and publishes evidence after invalidation', async () => {
    const b = bucket()
    const before = Date.parse('2026-09-21T21:31:00Z')
    const after = Date.parse('2026-09-23T19:33:00Z')
    const source = [sourceRow(start), sourceRow(before), sourceRow(after), sourceRow(end - minute)]
    respond(source)
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    expect(await parquetReadObjects({ file: b.objects.get(dailyKey('2026-09-22'))!.bytes.buffer })).toEqual([])
    expect(await readSourceShard(b.r2, dailyKey('2026-09-21'), start, end)).toEqual(sourceRows([source[1]!], device, start, end))
    expect(b.writes).toEqual([
      journalKey,
      ...Array.from({ length: 30 }, (_, i) => dailyKey(`2026-09-${String(i + 1).padStart(2, '0')}`)),
      journalKey, snapshotKey,
    ])
    const snapshot = await (await b.r2.get(snapshotKey))!.json<Record<string, unknown>>()
    expect({ ...snapshot, reconciledAt: '<time>' }).toEqual({
      version: 1, month: '2026-09', sourceUrl: 'https://source.example/awair-137496/2026-09.parquet',
      sourceEtag: 'v1', reconciledAt: '<time>', start, end, rows: 4,
      gaps: [{ start: start + minute, end: before }, { start: before + minute, end: after }, { start: after + minute, end: end - minute }],
    })
    expect(await readDataGaps(b.r2, new Set([snapshotKey]))).toEqual(snapshot.gaps)
    const result = await writeShard({
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers[0]!, targetShardDur: '1mo',
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(end), effectiveStart: new Date(start), effectiveEnd: new Date(end),
    })
    expect({ status: result.status, rows: result.rows, inputsPresent: result.inputsPresent, inputsExpected: result.inputsExpected }).toEqual({ status: 'wrote', rows: 4, inputsPresent: 30, inputsExpected: 30 })
    expect(await readSourceShard(b.r2, result.key, start, end)).toEqual(sourceRows(source, device, start, end))
  })

  it('does not write evidence or shards on 404, malformed data, or an open month', async () => {
    const b = bucket()
    const fetch = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    expect(await reconcileMonth(opts(b.r2))).toBe(false)
    expect(await reconcileMonth({ ...opts(b.r2), now: new Date(end - 1) })).toBe(false)
    expect(fetch.mock.calls.length).toBe(1)
    // Exercise validation directly; a malformed Parquet encoder is not evidence of source validation.
    expect(() => sourceRows([{ ...sourceRow(start), co2: 'bad' }], device, start, end)).toThrow('Invalid raw source co2')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { etag: 'v1' } })))
    await expect(reconcileMonth(opts(b.r2))).rejects.toThrow()
    expect(b.writes).toEqual([])
  })

  it('repairs an empty day when the source ETag changes and conditionally rechecks stable sources', async () => {
    const b = bucket()
    respond([sourceRow(start)])
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    b.writes.length = 0
    const fetch = vi.fn(async () => new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetch)
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    expect(fetch.mock.calls).toEqual([[
      'https://source.example/awair-137496/2026-09.parquet',
      { headers: { 'If-None-Match': 'v1' }, signal: expect.any(AbortSignal) },
    ]])
    expect(b.writes).toEqual([])
    b.objects.delete(dailyKey('2026-09-22'))
    respond([sourceRow(start)])
    expect(await reconcileMonth({ ...opts(b.r2), repair: true })).toBe(true)
    expect(b.writes).toEqual([journalKey, dailyKey('2026-09-22'), journalKey, snapshotKey])
    b.writes.length = 0
    const repaired = sourceRow(Date.parse('2026-09-22T12:00:00Z'))
    respond([sourceRow(start), repaired], 'v2')
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    expect(b.writes).toEqual([journalKey, ...Array.from({ length: 30 }, (_, i) => dailyKey(`2026-09-${String(i + 1).padStart(2, '0')}`)), journalKey, snapshotKey])
    expect(await readSourceShard(b.r2, dailyKey('2026-09-22'), start, end)).toEqual(sourceRows([repaired], device, start, end))
  })

  it('retries a partially written month without publishing completion early', async () => {
    const b = bucket()
    const source = [sourceRow(start)]
    respond(source)
    const put = b.r2.put.bind(b.r2)
    vi.spyOn(b.r2, 'put').mockImplementation(async (...args: Parameters<R2Bucket['put']>) => {
      if (args[0] === dailyKey('2026-09-02')) throw new Error('write failed')
      return put(...args)
    })
    await expect(reconcileMonth(opts(b.r2))).rejects.toThrow('write failed')
    expect(b.writes).toEqual([journalKey, dailyKey('2026-09-01')])
    expect(await b.r2.get(snapshotKey)).toBeNull()
    vi.restoreAllMocks()
    b.writes.length = 0
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    expect(b.writes).toEqual([journalKey, ...Array.from({ length: 29 }, (_, i) => dailyKey(`2026-09-${String(i + 2).padStart(2, '0')}`)), journalKey, snapshotKey])
  })

  it('writes a valid all-empty downstream shard, but refuses unknown inputs', async () => {
    const b = bucket()
    respond([])
    expect(await reconcileMonth(opts(b.r2))).toBe(true)
    const monthly = await writeShard({
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers[0]!, targetShardDur: '1mo',
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(end), effectiveStart: new Date(start), effectiveEnd: new Date(end),
    })
    expect({ status: monthly.status, rows: monthly.rows }).toEqual({ status: 'wrote', rows: 0 })
    const writeOpts = {
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers.find(t => t.name === 'm3')!, targetShardDur: '1d' as const,
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(start + 86_400_000), effectiveStart: new Date(start), effectiveEnd: new Date(start + 86_400_000),
    }
    const written = await writeShard(writeOpts)
    expect({ status: written.status, rows: written.rows, inputsPresent: written.inputsPresent, inputsExpected: written.inputsExpected }).toEqual({ status: 'wrote', rows: 0, inputsPresent: 1, inputsExpected: 1 })
    expect(await readSourceShard(b.r2, written.key, start, end)).toEqual([])
    const empty = b.objects.get(written.key)!.bytes
    expect(parquetMetadata(empty.buffer.slice(empty.byteOffset, empty.byteOffset + empty.byteLength)).row_groups).toEqual([])
    b.objects.delete(monthly.key)
    b.writes.length = 0
    expect(await writeShard(writeOpts)).toEqual({ status: 'incomplete', key: written.key, inputsPresent: 0, inputsExpected: 1 })
    expect(b.writes).toEqual([])
  })

  it('blocks an old partial R2 input until its expected source is rebuilt', async () => {
    const b = bucket()
    const monthlyKey = 'pyramid/awair-137496/raw/1mo/2026-09.parquet'
    const source = [sourceRow(start, 2), sourceRow(start + minute, 4)]
    // Simulate the old writer leaving a partial body without registration.
    await b.r2.put(monthlyKey, encodeShard(sourceRows([source[0]!], device, start, end)))
    b.writes.length = 0
    const writeOpts = {
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers.find(t => t.name === 'm3')!, targetShardDur: '1d' as const,
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(start + 86_400_000), effectiveStart: new Date(start), effectiveEnd: new Date(start + 86_400_000),
      unavailableSourceKeys: new Set([monthlyKey]),
    }
    const result = await writeShard(writeOpts)
    expect({ status: result.status, key: result.key, inputsPresent: result.inputsPresent, inputsExpected: result.inputsExpected }).toEqual({
      status: 'incomplete', key: 'pyramid/awair-137496/m3/1d/2026-09-01.parquet', inputsPresent: 0, inputsExpected: 1,
    })
    expect(b.writes).toEqual([])
    expect(await b.r2.get(result.key)).toBeNull()
    respond(source)
    const monthly = await writeShard({
      ...opts(b.r2), targetTier: PYRAMID_CONFIG.tiers[0]!, targetShardDur: '1mo',
      targetPeriodStart: new Date(start), targetPeriodEnd: new Date(end), effectiveStart: new Date(start), effectiveEnd: new Date(end),
    })
    expect({ status: monthly.status, rows: monthly.rows }).toEqual({ status: 'wrote', rows: 2 })
    const fresh = await writeShard({ ...writeOpts, unavailableSourceKeys: new Set<string>() })
    expect({ status: fresh.status, rows: fresh.rows }).toEqual({ status: 'wrote', rows: 1 })
    expect(await readSourceShard(b.r2, fresh.key, start, end)).toEqual(coarsen(sourceRows(source, device, start, end), 3 * minute, device.id))
  })
})

describe('measurement gap boundaries', () => {
  it('uses missing minute bins, excludes short jitter, and merges month fragments', () => {
    expect(dataGaps(sourceRows([sourceRow(start), sourceRow(start + 5 * minute), sourceRow(start + 12 * minute)], device, start, end), start, start + 20 * minute)).toEqual([
      { start: start + 6 * minute, end: start + 12 * minute },
      { start: start + 13 * minute, end: start + 20 * minute },
    ])
    expect(mergeGaps([{ start: 20, end: 30 }, { start: 1, end: 10 }, { start: 10, end: 21 }, { start: 40, end: 50 }])).toEqual([{ start: 1, end: 30 }, { start: 40, end: 50 }])
  })
})
