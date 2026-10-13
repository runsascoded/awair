import { describe, expect, it } from 'vitest'
import { formatMeasurementGap } from './measurementGaps'

const options = { locale: 'en-US', timeZone: 'America/New_York', now: Date.parse('2026-10-13T12:00:00Z') }

describe('local measurement-gap labels', () => {
  it.each([
    ['2026-09-12T08:43:00Z', '2026-09-12T08:49:00Z', '9/12', '\u20074:43', '', '\u20074:49', '6m', 0, 6],
    ['2026-09-06T00:13:00Z', '2026-09-06T04:00:00Z', '9/5', '20:13', '9/6', '\u20070:00', '3h 47m', 3, 47],
    ['2026-09-21T21:33:00Z', '2026-09-23T19:33:00Z', '9/21', '17:33', '9/23', '15:33', '46h', 46, 0],
    ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '11/1', '\u20071:30 EDT', '', '\u20071:30 EST', '1h', 1, 0],
    ['2026-01-01T04:30:00Z', '2026-01-01T05:30:00Z', '12/31/2025', '23:30', '1/1/2026', '\u20070:30', '1h', 1, 0],
    ['2025-09-12T08:43:00Z', '2025-09-13T08:49:00Z', '9/12/2025', '\u20074:43', '9/13', '\u20074:49', '24h 6m', 24, 6],
  ])('formats %s → %s without losing calendar or offset changes', (from, to, startDate, startTime, endDate, endTime, duration, durationHours, durationMinutes) => {
    const gap = { start: Date.parse(from), end: Date.parse(to) }
    const startLabel = `${startDate} ${startTime.trimStart()}`
    const endLabel = endDate ? `${endDate} ${endTime.trimStart()}` : endTime.trimStart()
    expect(formatMeasurementGap(gap, options)).toEqual({
      ...gap, startDate, startTime, endDate, endTime, duration, durationHours, durationMinutes,
      label: `Missing measurements: ${startLabel} → ${endLabel} · ${duration} (America/New_York)`,
    })
  })
})
