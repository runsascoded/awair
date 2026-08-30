import { describe, expect, it } from 'vitest'
import { humanDuration, transition, utcDayLabel, type CheckResult, type StateRow } from './health'

const T = 1_000_000
const okRes = (id: string, min = 1): CheckResult => ({ id, ok: true, detail: `${id} ok`, minConsecutive: min })
const failRes = (id: string, min = 1): CheckResult => ({ id, ok: false, detail: `${id} fail`, minConsecutive: min })

describe('transition', () => {
  it('first-ever ok tick: healthy state, no alert', () => {
    const { next, alert } = transition(undefined, okRes('c'), T)
    expect(alert).toBeUndefined()
    expect(next).toEqual<StateRow>({
      checkId: 'c', failing: false, consecutive: 0, alerted: false,
      since: null, detail: 'c ok', updatedAt: T,
    })
  })

  it('minConsecutive=1 fail: pages down immediately', () => {
    const { next, alert } = transition(undefined, failRes('c', 1), T)
    expect(alert).toEqual({ kind: 'down', checkId: 'c', detail: 'c fail' })
    expect(next).toEqual<StateRow>({
      checkId: 'c', failing: true, consecutive: 1, alerted: true,
      since: T, detail: 'c fail', updatedAt: T,
    })
  })

  it('minConsecutive=3: silent for ticks 1–2, pages on tick 3, silent after', () => {
    let state: StateRow | undefined
    const alerts: (string | undefined)[] = []
    const consecutives: number[] = []
    for (let i = 0; i < 4; i++) {
      const { next, alert } = transition(state, failRes('c', 3), T + i)
      state = next
      alerts.push(alert?.kind)
      consecutives.push(next.consecutive)
    }
    expect(consecutives).toEqual([1, 2, 3, 4])
    expect(alerts).toEqual([undefined, undefined, 'down', undefined])
  })

  it('recovery pages once after a down streak, then clears', () => {
    const down = transition(undefined, failRes('c', 1), T)
    expect(down.alert?.kind).toBe('down')
    const rec = transition(down.next, okRes('c'), T + 1)
    expect(rec.alert).toEqual({ kind: 'recovered', checkId: 'c', detail: 'c ok' })
    expect(rec.next).toEqual<StateRow>({
      checkId: 'c', failing: false, consecutive: 0, alerted: false,
      since: null, detail: 'c ok', updatedAt: T + 1,
    })
    // A second ok tick after recovery must not re-page.
    expect(transition(rec.next, okRes('c'), T + 2).alert).toBeUndefined()
  })

  it('failing-but-never-paged then recovering: no recovery page', () => {
    // Two failing ticks under minConsecutive=3 (never alerted) then ok.
    const t1 = transition(undefined, failRes('c', 3), T)
    const t2 = transition(t1.next, failRes('c', 3), T + 1)
    expect(t1.alert).toBeUndefined()
    expect(t2.alert).toBeUndefined()
    const rec = transition(t2.next, okRes('c'), T + 2)
    expect(rec.alert).toBeUndefined()
    expect(rec.next.failing).toBe(false)
  })

  it('a failing streak that spans the alert threshold keeps `since` fixed', () => {
    const t1 = transition(undefined, failRes('c', 2), T)
    const t2 = transition(t1.next, failRes('c', 2), T + 5)
    expect(t2.alert?.kind).toBe('down')
    expect(t2.next.since).toBe(T) // streak start, not the alerting tick
  })
})

describe('humanDuration', () => {
  it('formats across unit boundaries', () => {
    expect([
      humanDuration(45_000),
      humanDuration(125_000),
      humanDuration(3 * 3600_000 + 4 * 60_000),
      humanDuration(2 * 86_400_000 + 5 * 3600_000),
    ]).toEqual(['45s', '2m 5s', '3h 4m', '2d 5h'])
  })
})

describe('utcDayLabel', () => {
  it('is the UTC calendar day', () => {
    expect(utcDayLabel(Date.parse('2026-08-30T23:59:00Z'))).toBe('2026-08-30')
    expect(utcDayLabel(Date.parse('2026-08-31T00:00:00Z'))).toBe('2026-08-31')
  })
})
