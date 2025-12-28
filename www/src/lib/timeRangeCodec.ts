/**
 * Time range codec - encoding/decoding utilities without external dependencies
 * Safe for testing (no React dependencies)
 */

import { floor } from '@rdub/base'
import { splitDate } from "../utils/dateFormat"

/**
 * Time range configuration
 */
export type TimeRange = {
  /** End timestamp (null = Latest mode - follow newest data) */
  timestamp: Date | null
  /** Lookback duration in milliseconds */
  duration: number
}

/**
 * Parse compact timestamp: YYMMDD[THHMMSS]
 * Supports prefixes - fills in zeros for unspecified parts
 *
 * Examples:
 *   251123       → 2025-11-23 00:00:00
 *   251123T04    → 2025-11-23 04:00:00
 *   251123T0432  → 2025-11-23 04:32:00
 *   25           → 2025-01-01 00:00:00
 */
function parseCompactTimestamp(compact: string): Date {
  // Remove 'T' separator if present
  const parts = compact.split('T')
  const datePart = parts[0] || ''
  const timePart = parts[1] || ''

  // Pad date part to 6 chars (YYMMDD)
  const paddedDate = datePart.padEnd(6, '0')
  const yy = paddedDate.slice(0, 2)
  const mm = paddedDate.slice(2, 4)
  const dd = paddedDate.slice(4, 6)

  // Pad time part to 6 chars (HHMMSS)
  const paddedTime = timePart.padEnd(6, '0')
  const hh = paddedTime.slice(0, 2)
  const min = paddedTime.slice(2, 4)
  const ss = paddedTime.slice(4, 6)

  // Construct full year (assume 2000s)
  const year = 2000 + parseInt(yy, 10)
  const month = parseInt(mm, 10) || 1  // Default to January if 0
  const day = parseInt(dd, 10) || 1    // Default to 1st if 0

  return new Date(
    year,
    month - 1,  // JS months are 0-indexed
    day,
    parseInt(hh, 10),
    parseInt(min, 10),
    parseInt(ss, 10)
  )
}

/**
 * Encode timestamp to compact format: YYMMDD[THHMMSS]
 * Omits trailing zeros (midnight = YYMMDD, no time part needed)
 */
function encodeCompactTimestamp(date: Date): string {
  const { yy, mm, dd, HH, MM, SS } = splitDate(date)
  const datePart = `${yy}${mm}${dd}`

  // Only include time if non-zero
  if (HH !== '00' || MM !== '00' || SS !== '00') {
    // Trim trailing zeros from time
    let timePart = `${HH}${MM}${SS}`
    // Remove trailing 00s
    timePart = timePart.replace(/(?:00)+$/, '')
    return `${datePart}T${timePart}`
  }

  return datePart
}

/**
 * Parse duration string: 1d, 3d, 1d3h10m, etc.
 * Returns duration in milliseconds
 */
function parseDuration(duration: string): number {
  let total = 0
  const pattern = /(\d+)([dhm])/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(duration)) !== null) {
    const value = parseInt(match[1], 10)
    const unit = match[2]

    switch (unit) {
      case 'd':
        total += value * 24 * 60 * 60 * 1000
        break
      case 'h':
        total += value * 60 * 60 * 1000
        break
      case 'm':
        total += value * 60 * 1000
        break
    }
  }

  return total
}

/**
 * Encode duration to compact string: 1d, 3d, 1d3h10m, etc.
 * Omits zero components
 */
function encodeDuration(ms: number): string {
  const days = floor(ms / (24 * 60 * 60 * 1000))
  ms -= days * 24 * 60 * 60 * 1000

  const hours = floor(ms / (60 * 60 * 1000))
  ms -= hours * 60 * 60 * 1000

  const minutes = floor(ms / (60 * 1000))

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)

  return parts.length > 0 ? parts.join('') : '0m'
}

/**
 * Encode time range to compact URL format
 *
 * Format: [{timestamp}][-{duration}]
 *   - Timestamp: YYMMDD[THHMMSS] (prefix-compatible, omits time if midnight)
 *   - Duration: 1d, 3d, 1d3h10m (omits zero components)
 *
 * Special cases:
 *   - Absent/undefined → Latest mode, 1 day lookback (default)
 *   - `-3d` → Latest mode, 3 days lookback (no timestamp)
 *   - `251123` → 2025-11-23 00:00:00, 1 day lookback (duration defaults to 1d)
 *   - `251123-3d` → 2025-11-23 00:00:00, 3 days lookback
 *   - `251123T0432-1d3h` → 2025-11-23 04:32:00, 1 day + 3 hours lookback
 */
export function encodeTimeRange(range: TimeRange): string | undefined {
  const oneDayMs = 24 * 60 * 60 * 1000

  // Default state (Latest mode + 1d) → no param
  if (range.timestamp === null && range.duration === oneDayMs) {
    return undefined
  }

  // Latest mode with custom duration → `-{duration}`
  if (range.timestamp === null || range.timestamp === undefined) {
    return `-${encodeDuration(range.duration)}`
  }

  // Fixed timestamp + 1d duration → `{timestamp}` (duration omitted)
  const timestampStr = encodeCompactTimestamp(range.timestamp)
  if (range.duration === oneDayMs) {
    return timestampStr
  }

  // Fixed timestamp + custom duration → `{timestamp}-{duration}`
  return `${timestampStr}-${encodeDuration(range.duration)}`
}

/**
 * Decode compact URL format to time range
 */
export function decodeTimeRange(encoded: string | undefined): TimeRange {
  const oneDayMs = 24 * 60 * 60 * 1000

  // Absent → Latest mode + 1d
  if (!encoded) {
    return { timestamp: null, duration: oneDayMs }
  }

  // Check for duration-only format: `-{duration}`
  if (encoded.startsWith('-')) {
    return {
      timestamp: null,
      duration: parseDuration(encoded.slice(1))
    }
  }

  // Split timestamp and duration
  const dashIndex = encoded.indexOf('-')
  if (dashIndex === -1) {
    // Timestamp only, duration defaults to 1d
    return {
      timestamp: parseCompactTimestamp(encoded),
      duration: oneDayMs
    }
  }

  // Both timestamp and duration present
  const timestampStr = encoded.slice(0, dashIndex)
  const durationStr = encoded.slice(dashIndex + 1)

  return {
    timestamp: parseCompactTimestamp(timestampStr),
    duration: parseDuration(durationStr)
  }
}
