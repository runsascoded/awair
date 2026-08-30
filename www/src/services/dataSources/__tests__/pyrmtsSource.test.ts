import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PyrmtsSource } from '../pyrmtsSource'
import type { FetchOptions } from '../../dataSource'

/** Minimal `Response` stand-in carrying a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(text.length) : null) },
    text: async () => text,
  } as unknown as Response
}

const EMPTY_PLAN = {
  records: [],
  plan: { outputBin: '10min', authoritativeEnd: null, segments: [] },
}
const DATA_PLAN = {
  records: [{ ts: 1_000, device_id: 17617, temp_n: 1, temp_sum: 21 }],
  plan: {
    outputTier: 'm10', outputBin: '10min', authoritativeEnd: null,
    segments: [{ tier: 'm10', from: '', to: '', reaggregate: false, keys: ['k'] }],
  },
}

const opts: FetchOptions = {
  deviceId: 17617,
  range: { from: new Date('2026-08-15T00:00:00Z'), to: new Date('2026-08-22T00:00:00Z') },
  binBudget: 800,
}

describe('PyrmtsSource empty-plan retry', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not retry when the first response has data', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DATA_PLAN))
    const p = new PyrmtsSource().fetch(opts)
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.records.map(r => r.temp)).toEqual([21])
  })

  it('retries a transient empty plan and returns the data once it lands', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(EMPTY_PLAN))
      .mockResolvedValueOnce(jsonResponse(EMPTY_PLAN))
      .mockResolvedValueOnce(jsonResponse(DATA_PLAN))
    const p = new PyrmtsSource().fetch(opts)
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.records.map(r => r.temp)).toEqual([21])
  })

  it('gives up after 3 retries (4 attempts) and returns the empty result', async () => {
    fetchMock.mockResolvedValue(jsonResponse(EMPTY_PLAN))
    const p = new PyrmtsSource().fetch(opts)
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(res.records).toEqual([])
  })

  it('does not treat a non-empty-but-untiered edge as retryable (0 records only)', async () => {
    // A plan that named a tier but returned no rows is a real empty range,
    // not the transient — must not spin the retry loop.
    fetchMock.mockResolvedValue(jsonResponse({
      records: [],
      plan: { outputTier: 'm10', outputBin: '10min', authoritativeEnd: null, segments: [] },
    }))
    const p = new PyrmtsSource().fetch(opts)
    await vi.runAllTimersAsync()
    const res = await p
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.records).toEqual([])
  })
})
