import { describe, expect, it } from 'vitest'
import { checkRawTips, rawTipKey, type MonitorEnv } from './monitor'
import { DEFAULT_THRESHOLDS, type CheckResult } from './health'
import type { Device } from './devices'

const GYM: Device = { id: 17617, name: 'Gym', genesisDate: new Date('2025-06-01T00:00:00Z') }

/** Fake R2 whose `head` returns the mapped object (or null) per exact key. */
function fakeEnv(objs: Record<string, { uploaded: Date }>): MonitorEnv {
  return {
    PYRAMID: {
      head: async (key: string) => objs[key] ?? null,
    },
  } as unknown as MonitorEnv
}

// 30s past the UTC-midnight rollover: today's tip may not exist yet.
const NOW = Date.parse('2026-09-01T00:00:30Z')
const DAY = 86_400_000
const todayKey = rawTipKey(GYM.id, NOW)
const yestKey = rawTipKey(GYM.id, NOW - DAY)
const run = (objs: Record<string, { uploaded: Date }>): Promise<CheckResult[]> =>
  checkRawTips(fakeEnv(objs), [GYM], NOW, DEFAULT_THRESHOLDS)

describe('checkRawTips UTC-boundary handling', () => {
  it('keys today and yesterday to the right UTC days', () => {
    expect([todayKey, yestKey]).toEqual([
      'pyramid/awair-17617/raw/1d/2026-09-01.parquet',
      'pyramid/awair-17617/raw/1d/2026-08-31.parquet',
    ])
  })

  it('today missing + yesterday fresh ⇒ ok (the midnight false-page fix)', async () => {
    const res = await run({ [yestKey]: { uploaded: new Date(NOW - 30_000) } })
    expect(res).toEqual<CheckResult[]>([
      { id: 'raw-tip:17617', ok: true, detail: 'Gym (17617): raw tip 30s old', minConsecutive: 1 },
    ])
  })

  it('today present + fresh ⇒ ok (normal mid-day path)', async () => {
    const res = await run({ [todayKey]: { uploaded: new Date(NOW - 40_000) } })
    expect(res).toEqual<CheckResult[]>([
      { id: 'raw-tip:17617', ok: true, detail: 'Gym (17617): raw tip 40s old', minConsecutive: 1 },
    ])
  })

  it('today missing + yesterday stale ⇒ down (dead Lambda still pages)', async () => {
    const res = await run({ [yestKey]: { uploaded: new Date(NOW - 3 * 3600_000) } })
    expect(res).toEqual<CheckResult[]>([
      { id: 'raw-tip:17617', ok: false, detail: 'Gym (17617): raw tip 3h 0m old', minConsecutive: 1 },
    ])
  })

  it('both days missing ⇒ down, naming both days', async () => {
    const res = await run({})
    expect(res).toEqual<CheckResult[]>([
      { id: 'raw-tip:17617', ok: false, detail: 'Gym (17617): no raw tip for 2026-09-01 or 2026-08-31', minConsecutive: 1 },
    ])
  })
})
