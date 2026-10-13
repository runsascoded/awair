import { describe, expect, it } from 'vitest'
import { formatMeasurementGap } from './measurementGaps'

const options = { locale: 'en-US', timeZone: 'America/New_York', now: Date.parse('2026-10-13T12:00:00Z') }

describe('local measurement-gap labels', () => {
  it.each([
    ['2026-09-12T08:43:00Z', '2026-09-12T08:49:00Z', '9/12', '04:43', '', '04:49', '6m'],
    ['2026-09-06T00:13:00Z', '2026-09-06T04:00:00Z', '9/5', '20:13', '9/6', '00:00', '3h 47m'],
    ['2026-09-21T21:33:00Z', '2026-09-23T19:33:00Z', '9/21', '17:33', '9/23', '15:33', '46h'],
    ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '11/1', '01:30 EDT', '', '01:30 EST', '1h'],
    ['2026-01-01T04:30:00Z', '2026-01-01T05:30:00Z', '12/31/2025', '23:30', '1/1/2026', '00:30', '1h'],
    ['2025-09-12T08:43:00Z', '2025-09-13T08:49:00Z', '9/12/2025', '04:43', '9/13', '04:49', '24h 6m'],
  ])('formats %s → %s without losing calendar or offset changes', (from, to, startDate, startTime, endDate, endTime, duration) => {
    const gap = { start: Date.parse(from), end: Date.parse(to) }
    const startLabel = `${startDate} ${startTime}`
    const endLabel = endDate ? `${endDate} ${endTime}` : endTime
    expect(formatMeasurementGap(gap, options)).toEqual({
      ...gap, startDate, startTime, endDate, endTime, duration,
      label: `Missing measurements: ${startLabel} → ${endLabel} · ${duration} (America/New_York)`,
    })
  })
})
