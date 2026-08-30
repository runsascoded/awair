import { describe, expect, it } from 'vitest'
import { parseEvent, summarize, type ServeEvent } from './events'

describe('parseEvent', () => {
  it('accepts a full client_empty payload, coercing types', () => {
    expect(parseEvent({
      kind: 'client_empty', deviceId: '17617', binBudget: 800,
      rangeFrom: 1000, rangeTo: 2000, smooth: '12h', attempts: 2, recovered: true,
    })).toEqual<ServeEvent>({
      kind: 'client_empty', deviceId: 17617, binBudget: 800,
      rangeFrom: 1000, rangeTo: 2000, smooth: '12h', status: undefined,
      attempts: 2, recovered: true, detail: undefined,
    })
  })

  it('rejects missing / unknown kinds', () => {
    expect(parseEvent({ deviceId: 1 })).toBeNull()
    expect(parseEvent({ kind: 'nope' })).toBeNull()
    expect(parseEvent(null)).toBeNull()
    expect(parseEvent('client_empty')).toBeNull()
  })

  it('clamps string lengths and drops non-boolean recovered', () => {
    const ev = parseEvent({
      kind: 'client_error', status: '502',
      detail: 'x'.repeat(600), smooth: 'y'.repeat(50), recovered: 'yes',
    })
    expect(ev).toEqual<ServeEvent>({
      kind: 'client_error', deviceId: undefined, binBudget: undefined,
      rangeFrom: undefined, rangeTo: undefined, smooth: 'y'.repeat(32),
      status: 502, attempts: undefined, recovered: undefined, detail: 'x'.repeat(500),
    })
  })

  it('drops non-finite numbers', () => {
    const ev = parseEvent({ kind: 'probe_empty', deviceId: 'abc', binBudget: NaN })
    expect(ev?.deviceId).toBeUndefined()
    expect(ev?.binBudget).toBeUndefined()
  })
})

/** Fake D1 returning canned rows for the single SELECT `summarize` runs. */
function fakeDb(rows: Record<string, unknown>[]): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) }),
    }),
  } as unknown as D1Database
}

describe('summarize', () => {
  const day = (d: string, ms = 0) => Date.parse(`${d}T00:00:00Z`) + ms
  it('buckets by kind and by day (newest-first), caps recent', async () => {
    const rows = [
      { id: 4, ts: day('2026-08-30', 3), kind: 'client_empty' },
      { id: 3, ts: day('2026-08-30', 2), kind: 'probe_empty' },
      { id: 2, ts: day('2026-08-30', 1), kind: 'probe_empty' },
      { id: 1, ts: day('2026-08-29'), kind: 'probe_empty' },
    ]
    const now = day('2026-08-30', 10)
    const s = await summarizeSync(rows, now)
    expect(s.byKind).toEqual({ client_empty: 1, probe_empty: 3 })
    expect(s.byDay).toEqual([
      { day: '2026-08-30', kind: 'client_empty', count: 1 },
      { day: '2026-08-30', kind: 'probe_empty', count: 2 },
      { day: '2026-08-29', kind: 'probe_empty', count: 1 },
    ])
    expect(s.recent.map(r => r.id)).toEqual([4, 3])
  })

  // Wrapper so the assertions above read synchronously.
  async function summarizeSync(rows: Record<string, unknown>[], now: number) {
    return summarize(fakeDb(rows), now - 7 * 86_400_000, now, 2)
  }
})
