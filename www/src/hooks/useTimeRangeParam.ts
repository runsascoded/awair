import { useCallback, useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

/**
 * Hook for managing time range state
 *
 * Converts between TimeRange (timestamp + duration) and xAxisRange ([start, end])
 * for backwards compatibility with existing chart code
 */
export function useTimeRangeParam(
  data: AwairRecord[],
  formatForPlotly: (date: Date) => string,
  timeRange: { timestamp: Date | null; duration: number },
  setTimeRange: (range: { timestamp: Date | null; duration: number }) => void
) {

  // Convert TimeRange to xAxisRange format
  const xAxisRange = useMemo((): [string, string] | null => {
    if (data.length === 0) return null

    // Latest mode: use latest data timestamp as end
    if (timeRange.timestamp === null) {
      const latestTime = new Date(data[0].timestamp)
      const earliestTime = new Date(latestTime.getTime() - timeRange.duration)
      return [formatForPlotly(earliestTime), formatForPlotly(latestTime)]
    }

    // Fixed timestamp mode: use specified timestamp as end
    const endTime = timeRange.timestamp
    const startTime = new Date(endTime.getTime() - timeRange.duration)
    return [formatForPlotly(startTime), formatForPlotly(endTime)]
  }, [timeRange, data, formatForPlotly])

  // Latest mode is when timestamp is null
  const latestModeIntended = timeRange.timestamp === null

  // Set time range from xAxisRange (for backwards compatibility with existing handlers)
  const setXAxisRange = useCallback((range: [string, string] | null) => {
    if (range === null) {
      // Reset to default
      setTimeRange({ timestamp: null, duration: 24 * 60 * 60 * 1000 })
      return
    }

    const startTime = new Date(range[0])
    const endTime = new Date(range[1])
    const duration = endTime.getTime() - startTime.getTime()

    // Determine if this should be Latest mode or fixed timestamp
    // Check if end time is close to latest data (within 10 minutes)
    if (data.length > 0) {
      const latestDataTime = new Date(data[0].timestamp)
      const timeDiffMinutes = Math.abs(endTime.getTime() - latestDataTime.getTime()) / (1000 * 60)

      if (timeDiffMinutes < 10) {
        // Close to latest, use Latest mode
        setTimeRange({ timestamp: null, duration })
      } else {
        // Not at latest, use fixed timestamp
        setTimeRange({ timestamp: endTime, duration })
      }
    } else {
      // No data, default to Latest mode
      setTimeRange({ timestamp: null, duration })
    }
  }, [data, setTimeRange])

  // Enable/disable Latest mode (preserving duration)
  const setLatestModeIntended = useCallback((enabled: boolean) => {
    setTimeRange({
      timestamp: enabled ? null : (data.length > 0 ? new Date(data[0].timestamp) : new Date()),
      duration: timeRange.duration
    })
  }, [data, setTimeRange, timeRange.duration])

  // Update duration (preserving Latest mode state)
  const setDuration = useCallback((duration: number) => {
    // Don't create new object from stale timeRange - let setTimeRange handle it
    // by passing the current timestamp (which should be null for Latest mode)
    setTimeRange({ timestamp: timeRange.timestamp, duration })
  }, [setTimeRange, timeRange.timestamp])

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
