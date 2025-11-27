import { useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

export interface TimeWindow {
  label: string
  minutes: number
}

interface AggregatedData {
  timestamp: string
  temp_avg: number
  temp_stddev: number
  co2_avg: number
  co2_stddev: number
  humid_avg: number
  humid_stddev: number
  pm25_avg: number
  pm25_stddev: number
  voc_avg: number
  voc_stddev: number
  count: number
}

export const TIME_WINDOWS: TimeWindow[] = [
  { label: '1m', minutes: 1 },
  { label: '2m', minutes: 2 },
  { label: '3m', minutes: 3 },
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: '6h', minutes: 360 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
  { label: '2d', minutes: 2880 },
]

// Aggregate data into time windows for performance and visual clarity
function aggregateData(data: AwairRecord[], windowMinutes: number): AggregatedData[] {
  if (data.length === 0) return []

  // For 1-minute windows, return raw data in the expected format
  if (windowMinutes === 1) {
    return data.map(record => ({
      timestamp: record.timestamp,
      temp_avg: record.temp,
      temp_stddev: 0,
      co2_avg: record.co2,
      co2_stddev: 0,
      humid_avg: record.humid,
      humid_stddev: 0,
      pm25_avg: record.pm25,
      pm25_stddev: 0,
      voc_avg: record.voc,
      voc_stddev: 0,
      count: 1,
    }))
  }

  const windowMs = windowMinutes * 60 * 1000
  const groups: { [key: string]: AwairRecord[] } = {}

  // Group data by time windows
  data.forEach(record => {
    const timestamp = new Date(record.timestamp).getTime()
    const windowStart = Math.floor(timestamp / windowMs) * windowMs
    const key = new Date(windowStart).toISOString()

    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(record)
  })

  // Calculate standard deviation
  const calculateStdDev = (values: number[]): number => {
    if (values.length <= 1) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2))
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(avgSquaredDiff)
  }

  // Aggregate each group and ensure chronological order
  return Object.entries(groups)
    .map(([timestamp, records]) => {
      const temps = records.map(r => r.temp)
      const co2s = records.map(r => r.co2)
      const humids = records.map(r => r.humid)
      const pm25s = records.map(r => r.pm25)
      const vocs = records.map(r => r.voc)

      return {
        timestamp,
        temp_avg: temps.reduce((a, b) => a + b, 0) / temps.length,
        temp_stddev: calculateStdDev(temps),
        co2_avg: co2s.reduce((a, b) => a + b, 0) / co2s.length,
        co2_stddev: calculateStdDev(co2s),
        humid_avg: humids.reduce((a, b) => a + b, 0) / humids.length,
        humid_stddev: calculateStdDev(humids),
        pm25_avg: pm25s.reduce((a, b) => a + b, 0) / pm25s.length,
        pm25_stddev: calculateStdDev(pm25s),
        voc_avg: vocs.reduce((a, b) => a + b, 0) / vocs.length,
        voc_stddev: calculateStdDev(vocs),
        count: records.length,
      }
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

/**
 * Calculate responsive target points based on container width.
 * Mobile gets fewer points, desktop gets more.
 */
export function getTargetPoints(containerWidth?: number): number {
  if (!containerWidth) return 300
  // Scale from ~100 points at 375px to ~400 points at 1600px
  return Math.max(100, Math.min(400, Math.floor(containerWidth / 4)))
}

/**
 * Get min/max point constraints based on container width.
 * Ensures windows aren't too sparse or dense for the display.
 */
function getPointConstraints(containerWidth?: number): { minPoints: number; maxPoints: number } {
  const target = getTargetPoints(containerWidth)
  return {
    minPoints: Math.floor(target * 0.1),   // 10% of target (e.g., 30 for 300)
    maxPoints: Math.floor(target * 5),      // 5x target (e.g., 1500 for 300)
  }
}

/**
 * Get valid window options for a given time range.
 * Filters to windows that produce reasonable point counts for the container.
 */
export function getValidWindows(timeRangeMinutes: number, containerWidth?: number): TimeWindow[] {
  const { minPoints, maxPoints } = getPointConstraints(containerWidth)
  return TIME_WINDOWS.filter(window => {
    const estimatedPoints = Math.ceil(timeRangeMinutes / window.minutes)
    return estimatedPoints >= minPoints && estimatedPoints <= maxPoints
  })
}

/**
 * Find the optimal aggregation window size.
 * @param timeRangeMinutes - The visible time range in minutes
 * @param data - Full dataset (used when timeRangeMinutes not provided)
 * @param targetPoints - Target number of points (responsive to width)
 * @param overrideWindow - User-selected window override
 */
export function findOptimalWindow(
  timeRangeMinutes?: number,
  data?: AwairRecord[],
  targetPoints: number = 300,
  overrideWindow?: TimeWindow
): TimeWindow {
  // If user has selected a specific window, use it (if valid)
  if (overrideWindow) {
    return overrideWindow
  }

  if (timeRangeMinutes) {
    // Find the window whose px/point is closest to target in log space
    let bestWindow = TIME_WINDOWS[0]
    let bestLogDiff = Infinity

    for (const window of TIME_WINDOWS) {
      const estimatedPoints = Math.ceil(timeRangeMinutes / window.minutes)
      // Log difference between actual and target points
      const logDiff = Math.abs(Math.log(estimatedPoints) - Math.log(targetPoints))

      if (logDiff < bestLogDiff) {
        bestLogDiff = logDiff
        bestWindow = window
      }
    }

    return bestWindow
  } else if (data && data.length > 1) {
    // Full dataset: calculate window based on total time span
    const firstTime = new Date(data[data.length - 1].timestamp).getTime()
    const lastTime = new Date(data[0].timestamp).getTime()
    const totalMinutes = (lastTime - firstTime) / (1000 * 60)

    let selectedWindow = TIME_WINDOWS[TIME_WINDOWS.length - 1]

    for (let i = TIME_WINDOWS.length - 1; i >= 0; i--) {
      const window = TIME_WINDOWS[i]
      const estimatedPoints = Math.ceil(totalMinutes / window.minutes)

      if (estimatedPoints < targetPoints) {
        selectedWindow = window
      } else {
        if (i < TIME_WINDOWS.length - 1) {
          selectedWindow = TIME_WINDOWS[i + 1]
        }
        break
      }
    }
    return selectedWindow
  } else {
    // Fallback to middle window
    return TIME_WINDOWS[Math.floor(TIME_WINDOWS.length / 2)]
  }
}

export interface UseDataAggregationOptions {
  containerWidth?: number
  overrideWindow?: TimeWindow
  targetPx?: number | null  // Target pixels per point (null = use overrideWindow)
}

export function useDataAggregation(
  data: AwairRecord[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions = {}
) {
  const { containerWidth, overrideWindow, targetPx } = options
  const rangeKey = xAxisRange ? `${xAxisRange[0]}-${xAxisRange[1]}` : 'null'
  // If targetPx is set, calculate target points from container width
  // Otherwise fall back to the old responsive calculation
  const targetPoints = (targetPx && containerWidth)
    ? Math.floor(containerWidth / targetPx)
    : getTargetPoints(containerWidth)

  const { dataToAggregate, selectedWindow, timeRangeMinutes, validWindows } = useMemo(() => {
    let dataToAggregate = data
    let timeRangeMinutes: number | undefined

    if (xAxisRange) {
      const startTime = new Date(xAxisRange[0]).getTime()
      const endTime = new Date(xAxisRange[1]).getTime()
      timeRangeMinutes = (endTime - startTime) / (1000 * 60)

      dataToAggregate = data.filter(d => {
        const timestamp = new Date(d.timestamp).getTime()
        return timestamp >= startTime && timestamp <= endTime
      })
    } else if (data.length > 1) {
      // Calculate time range from full data
      const firstTime = new Date(data[data.length - 1].timestamp).getTime()
      const lastTime = new Date(data[0].timestamp).getTime()
      timeRangeMinutes = (lastTime - firstTime) / (1000 * 60)
    }

    const selectedWindow = findOptimalWindow(timeRangeMinutes, data, targetPoints, overrideWindow)
    const validWindows = timeRangeMinutes ? getValidWindows(timeRangeMinutes, containerWidth) : TIME_WINDOWS

    return {
      dataToAggregate,
      selectedWindow,
      timeRangeMinutes,
      validWindows,
    }
  }, [data, rangeKey, targetPoints, overrideWindow])

  const aggregatedData = useMemo(() => {
    return aggregateData(dataToAggregate, selectedWindow.minutes)
  }, [dataToAggregate, selectedWindow.minutes])

  return {
    aggregatedData,
    selectedWindow,
    validWindows,
    isRawData: selectedWindow.minutes === 1,
  }
}

export type { AggregatedData }
