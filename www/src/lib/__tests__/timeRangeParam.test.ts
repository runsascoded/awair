import { describe, it, expect } from 'vitest'
import { encodeTimeRange, decodeTimeRange, type TimeRange } from '../timeRangeCodec'

describe('timeRangeParam', () => {
  const oneDayMs = 24 * 60 * 60 * 1000
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000
  const oneDayThreeHoursMs = (24 * 60 * 60 + 3 * 60 * 60) * 1000

  describe('decode', () => {
    it('decodes absent param as Latest mode + 1d', () => {
      const result = decodeTimeRange(undefined)
      expect(result.timestamp).toBeNull()
      expect(result.duration).toBe(oneDayMs)
    })

    it('decodes duration-only as Latest mode', () => {
      const result = decodeTimeRange('-3d')
      expect(result.timestamp).toBeNull()
      expect(result.duration).toBe(threeDaysMs)
    })

    it('decodes timestamp-only as fixed timestamp + 1d', () => {
      const result = decodeTimeRange('251123')
      expect(result.timestamp).toEqual(new Date(2025, 10, 23, 0, 0, 0))
      expect(result.duration).toBe(oneDayMs)
    })

    it('decodes timestamp with time', () => {
      const result = decodeTimeRange('251123T0432')
      expect(result.timestamp).toEqual(new Date(2025, 10, 23, 4, 32, 0))
      expect(result.duration).toBe(oneDayMs)
    })

    it('decodes timestamp + duration', () => {
      const result = decodeTimeRange('251123-3d')
      expect(result.timestamp).toEqual(new Date(2025, 10, 23, 0, 0, 0))
      expect(result.duration).toBe(threeDaysMs)
    })

    it('decodes timestamp + complex duration', () => {
      const result = decodeTimeRange('251123T0432-1d3h')
      expect(result.timestamp).toEqual(new Date(2025, 10, 23, 4, 32, 0))
      expect(result.duration).toBe(oneDayThreeHoursMs)
    })

    it('handles prefix parsing', () => {
      // Just year (25 → 2025-01-01 00:00:00)
      const result1 = decodeTimeRange('25')
      expect(result1.timestamp).toEqual(new Date(2025, 0, 1, 0, 0, 0))

      // Year + month (2511 → 2025-11-01 00:00:00)
      const result2 = decodeTimeRange('2511')
      expect(result2.timestamp).toEqual(new Date(2025, 10, 1, 0, 0, 0))

      // Year + month + day with time prefix (251123T04 → 2025-11-23 04:00:00)
      const result3 = decodeTimeRange('251123T04')
      expect(result3.timestamp).toEqual(new Date(2025, 10, 23, 4, 0, 0))
    })
  })

  describe('encode', () => {
    it('encodes default state as undefined (no param)', () => {
      const result = encodeTimeRange({
        timestamp: null,
        duration: oneDayMs
      })
      expect(result).toBeUndefined()
    })

    it('encodes Latest mode + custom duration', () => {
      const result = encodeTimeRange({
        timestamp: null,
        duration: threeDaysMs
      })
      expect(result).toBe('-3d')
    })

    it('encodes fixed timestamp + 1d as timestamp-only', () => {
      const result = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 0, 0, 0),
        duration: oneDayMs
      })
      expect(result).toBe('251123')
    })

    it('encodes fixed timestamp with time + 1d', () => {
      const result = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 4, 32, 0),
        duration: oneDayMs
      })
      expect(result).toBe('251123T0432')
    })

    it('encodes fixed timestamp + custom duration', () => {
      const result = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 0, 0, 0),
        duration: threeDaysMs
      })
      expect(result).toBe('251123-3d')
    })

    it('encodes complex duration', () => {
      const result = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 4, 32, 0),
        duration: oneDayThreeHoursMs
      })
      expect(result).toBe('251123T0432-1d3h')
    })

    it('omits trailing time zeros', () => {
      // 04:32:00 → T0432 (no seconds)
      const result1 = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 4, 32, 0),
        duration: oneDayMs
      })
      expect(result1).toBe('251123T0432')

      // 04:00:00 → T04 (no minutes/seconds)
      const result2 = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 4, 0, 0),
        duration: oneDayMs
      })
      expect(result2).toBe('251123T04')

      // 00:00:00 → no time part
      const result3 = encodeTimeRange({
        timestamp: new Date(2025, 10, 23, 0, 0, 0),
        duration: oneDayMs
      })
      expect(result3).toBe('251123')
    })
  })

  describe('round-trip encoding', () => {
    const cases: TimeRange[] = [
      { timestamp: null, duration: oneDayMs },
      { timestamp: null, duration: threeDaysMs },
      { timestamp: new Date(2025, 10, 23, 0, 0, 0), duration: oneDayMs },
      { timestamp: new Date(2025, 10, 23, 4, 32, 0), duration: oneDayMs },
      { timestamp: new Date(2025, 10, 23, 0, 0, 0), duration: threeDaysMs },
      { timestamp: new Date(2025, 10, 23, 4, 32, 0), duration: oneDayThreeHoursMs },
    ]

    cases.forEach((input, i) => {
      it(`round-trip case ${i + 1}`, () => {
        const encoded = encodeTimeRange(input)
        const decoded = decodeTimeRange(encoded)
        expect(decoded).toEqual(input)
      })
    })
  })
})
