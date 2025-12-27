import { useCallback, useState, useRef, useEffect } from 'react'
import { formatForPlotly } from "../utils/dateFormat"
import type { AwairRecord } from '../types/awair'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Round duration to sensible precision based on magnitude (sigfigs approach).
 * Shorter durations get finer precision, longer durations get coarser.
 */
export function roundDuration(ms: number): number {
  if (ms < 2 * HOUR) {
    // < 2h: round to 5 min
    return Math.round(ms / (5 * MINUTE)) * (5 * MINUTE)
  } else if (ms < 12 * HOUR) {
    // 2h-12h: round to 15 min
    return Math.round(ms / (15 * MINUTE)) * (15 * MINUTE)
  } else if (ms < 3 * DAY) {
    // 12h-3d: round to 1 hour
    return Math.round(ms / HOUR) * HOUR
  } else if (ms < 14 * DAY) {
    // 3d-14d: round to 6 hours
    return Math.round(ms / (6 * HOUR)) * (6 * HOUR)
  } else {
    // > 14d: round to 1 day
    return Math.round(ms / DAY) * DAY
  }
}

/**
 * Format duration as compact string with at most 2 units (e.g., "4d6h", "2h30m").
 * Returns null if duration matches a preset exactly.
 */
export function formatDuration(ms: number): string | null {
  // Check if matches a preset (with small tolerance for rounding errors)
  const presets = [
    { ms: 12 * HOUR, label: '12h' },
    { ms: DAY, label: '1d' },
    { ms: 3 * DAY, label: '3d' },
    { ms: 7 * DAY, label: '7d' },
    { ms: 14 * DAY, label: '14d' },
    { ms: 31 * DAY, label: '1mo' },
    { ms: 62 * DAY, label: '2mo' },
    { ms: 92 * DAY, label: '3mo' },
  ]

  for (const preset of presets) {
    if (Math.abs(ms - preset.ms) < MINUTE) {
      return null // Matches preset, don't show custom
    }
  }

  // Format with at most 2 units
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  const minutes = Math.floor((ms % HOUR) / MINUTE)

  if (days > 0 && hours > 0) {
    return `${days}d${hours}h`
  } else if (days > 0) {
    return `${days}d`
  } else if (hours > 0 && minutes > 0) {
    return `${hours}h${minutes}m`
  } else if (hours > 0) {
    return `${hours}h`
  } else {
    return `${minutes}m`
  }
}

/**
 * Compute xAxisRange from data and timeRange.
 * Adds a buffer (half the window size) so edge points are hoverable.
 */
function computeRange(
  data: AwairRecord[],
  timeRange: { timestamp: Date | null; duration: number },
  windowMinutes: number
): [string, string] | null {
  if (data.length === 0) return null

  // Buffer = full aggregation window, so rightmost bar/point isn't at edge
  const bufferMs = windowMinutes * 60 * 1000

  let endTime: Date
  if (timeRange.timestamp === null) {
    // In Latest mode, use current time (not data timestamp which may be cached/stale)
    endTime = new Date(new Date().getTime() + bufferMs)
  } else {
    // Non-Latest mode: add buffer after the specified timestamp
    endTime = new Date(timeRange.timestamp.getTime() + bufferMs)
  }
  const startTime = new Date(endTime.getTime() - timeRange.duration)
  return [formatForPlotly(startTime), formatForPlotly(endTime)]
}

/**
 * Hook for managing time range state
 *
 * Simple approach: xAxisRange is stored directly, synced to URL via timeRange
 */
export function useTimeRangeParam(
  data: AwairRecord[],
  timeRange: { timestamp: Date | null; duration: number },
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void,
  windowMinutes: number,
) {
  // Buffer = full aggregation window, so rightmost bar/point isn't at edge
  const bufferMs = windowMinutes * 60 * 1000

  // Compute initial range synchronously to avoid null -> range transition
  const [xAxisRange, setXAxisRangeState] = useState<[string, string] | null>(
    () => computeRange(data, timeRange, windowMinutes)
  )

  // Track if we've initialized (to handle case where data wasn't ready on first render)
  const initializedRef = useRef(xAxisRange !== null)

  // If we didn't have data on first render, initialize now
  if (!initializedRef.current && data.length > 0) {
    const range = computeRange(data, timeRange, windowMinutes)
    if (range) {
      initializedRef.current = true
      setXAxisRangeState(range)
    }
  }

  // Latest mode is when timestamp is null
  const latestModeIntended = timeRange.timestamp === null

  // Sync xAxisRange when timeRange changes (from URL or external updates)
  useEffect(() => {
    if (data.length > 0 && initializedRef.current) {
      const range = computeRange(data, timeRange, windowMinutes)
      if (range) {
        setXAxisRangeState(range)
      }
    }
  }, [timeRange, data, windowMinutes])

  // Simple setXAxisRange - only updates URL param, xAxisRange syncs via useEffect
  const setXAxisRange = useCallback((
    range: [string, string] | null,
    options?: { duration?: number }
  ) => {
    if (range === null) {
      // Latest mode - use provided duration (rounded) or default to 1 day
      const duration = options?.duration !== undefined
        ? roundDuration(options.duration)
        : 24 * 60 * 60 * 1000
      setTimeRange({ timestamp: null, duration })
      return
    }

    // Sync to URL - xAxisRange will update via useEffect
    const endTime = new Date(range[1])
    // Duration comes from explicit option (rounded) or current timeRange state
    const duration = options?.duration !== undefined
      ? roundDuration(options.duration)
      : timeRange.duration

    // Check if close to latest (within 10 min) -> Latest mode
    const latestDataTime = data.length > 0 ? new Date(data[0].timestamp) : new Date()
    const timeDiffMinutes = Math.abs(endTime.getTime() - latestDataTime.getTime()) / (1000 * 60)

    if (timeDiffMinutes < 10) {
      setTimeRange({ timestamp: null, duration })
    } else {
      setTimeRange({ timestamp: endTime, duration })
    }
  }, [data, setTimeRange, timeRange.duration])

  // Toggle Latest mode
  const setLatestModeIntended = useCallback((enabled: boolean) => {
    const currentDuration = xAxisRange
      ? new Date(xAxisRange[1]).getTime() - new Date(xAxisRange[0]).getTime()
      : timeRange.duration

    if (enabled) {
      // Add buffer so latest point isn't at edge (use current time, not cached data)
      const endTime = new Date(new Date().getTime() + bufferMs)
      const startTime = new Date(endTime.getTime() - currentDuration)
      setXAxisRangeState([formatForPlotly(startTime), formatForPlotly(endTime)])
      setTimeRange({ timestamp: null, duration: currentDuration })
    } else if (xAxisRange) {
      const endTime = new Date(xAxisRange[1])
      setTimeRange({ timestamp: endTime, duration: currentDuration })
    }
  }, [xAxisRange, timeRange.duration, setTimeRange, bufferMs])

  // Update duration - keeps end time fixed, adjusts start time
  const setDuration = useCallback((duration: number) => {
    // Preserve current Latest mode state - don't switch modes just because of time proximity
    const wasInLatestMode = timeRange.timestamp === null

    // Determine end time: use current xAxisRange end, or current time if in Latest mode
    let endTime: Date
    if (xAxisRange) {
      endTime = new Date(xAxisRange[1])
    } else if (wasInLatestMode) {
      // Add buffer so latest point isn't at edge (use current time, not cached data)
      endTime = new Date(new Date().getTime() + bufferMs)
    } else {
      endTime = timeRange.timestamp!
    }

    const startTime = new Date(endTime.getTime() - duration)
    setXAxisRangeState([formatForPlotly(startTime), formatForPlotly(endTime)])
    setTimeRange({ timestamp: wasInLatestMode ? null : endTime, duration })
  }, [xAxisRange, timeRange.timestamp, setTimeRange, bufferMs])

  return {
    timeRange,
    xAxisRange,
    latestModeIntended,
    setTimeRange,
    setXAxisRange,
    setLatestModeIntended,
    setDuration
  }
}
