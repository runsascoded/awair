import { useCallback, useState, useRef, useEffect } from 'react'
import type { AwairRecord } from '../types/awair'

/**
 * Compute xAxisRange from data and timeRange
 */
// Buffer to add after the latest data point so it's hoverable (not at edge)
const LATEST_MODE_BUFFER_MS = 60 * 1000 // 1 minute

function computeRange(
  data: AwairRecord[],
  timeRange: { timestamp: Date | null; duration: number },
  formatForPlotly: (date: Date) => string
): [string, string] | null {
  if (data.length === 0) return null

  let endTime: Date
  if (timeRange.timestamp === null) {
    // In Latest mode, use current time (not data timestamp which may be cached/stale)
    endTime = new Date(new Date().getTime() + LATEST_MODE_BUFFER_MS)
  } else {
    endTime = timeRange.timestamp
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
  formatForPlotly: (date: Date) => string,
  timeRange: { timestamp: Date | null; duration: number },
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void
) {
  // Compute initial range synchronously to avoid null -> range transition
  const [xAxisRange, setXAxisRangeState] = useState<[string, string] | null>(
    () => computeRange(data, timeRange, formatForPlotly)
  )

  // Track if we've initialized (to handle case where data wasn't ready on first render)
  const initializedRef = useRef(xAxisRange !== null)

  // If we didn't have data on first render, initialize now
  if (!initializedRef.current && data.length > 0) {
    const range = computeRange(data, timeRange, formatForPlotly)
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
      const range = computeRange(data, timeRange, formatForPlotly)
      if (range) {
        setXAxisRangeState(range)
      }
    }
  }, [timeRange, data, formatForPlotly])

  // Simple setXAxisRange - only updates URL param, xAxisRange syncs via useEffect
  const setXAxisRange = useCallback((
    range: [string, string] | null,
    options?: { duration?: number }
  ) => {
    if (range === null) {
      setTimeRange({ timestamp: null, duration: 24 * 60 * 60 * 1000 })
      return
    }

    // Sync to URL - xAxisRange will update via useEffect
    const endTime = new Date(range[1])
    // Duration comes from explicit option or current timeRange state - never recalculated from range
    const duration = options?.duration ?? timeRange.duration

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
      const endTime = new Date(new Date().getTime() + LATEST_MODE_BUFFER_MS)
      const startTime = new Date(endTime.getTime() - currentDuration)
      setXAxisRangeState([formatForPlotly(startTime), formatForPlotly(endTime)])
      setTimeRange({ timestamp: null, duration: currentDuration })
    } else if (xAxisRange) {
      const endTime = new Date(xAxisRange[1])
      setTimeRange({ timestamp: endTime, duration: currentDuration })
    }
  }, [xAxisRange, timeRange.duration, setTimeRange, formatForPlotly])

  // Update duration - keeps end time fixed, adjusts start time
  const setDuration = useCallback((duration: number) => {
    // Determine end time: use current xAxisRange end, or current time if in Latest mode
    let endTime: Date
    let stayInLatestMode = false
    if (xAxisRange) {
      endTime = new Date(xAxisRange[1])
      // Check if current end is close to now (within 10 min) -> stay in Latest mode
      const now = new Date()
      const timeDiffMinutes = Math.abs(endTime.getTime() - now.getTime()) / (1000 * 60)
      stayInLatestMode = timeDiffMinutes < 10
    } else if (timeRange.timestamp === null) {
      // Add buffer so latest point isn't at edge (use current time, not cached data)
      endTime = new Date(new Date().getTime() + LATEST_MODE_BUFFER_MS)
      stayInLatestMode = true
    } else {
      endTime = timeRange.timestamp
    }

    const startTime = new Date(endTime.getTime() - duration)
    setXAxisRangeState([formatForPlotly(startTime), formatForPlotly(endTime)])
    setTimeRange({ timestamp: stayInLatestMode ? null : endTime, duration })
  }, [xAxisRange, timeRange.timestamp, setTimeRange, formatForPlotly])

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
