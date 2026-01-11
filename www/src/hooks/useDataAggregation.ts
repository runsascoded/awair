import { abs, ceil, floor, max, min, pow, sqrt } from '@rdub/base'
import { useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

export interface TimeWindow {
  label: string
  minutes: number
}

interface AggregatedData {
  timestamp: Date
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

/**
 * Result of rolling average with optional stddev.
 * Extends AwairRecord with rolling stddev fields when computed.
 */
export interface SmoothedRecord extends AwairRecord {
  temp_stddev?: number
  co2_stddev?: number
  humid_stddev?: number
  pm25_stddev?: number
  voc_stddev?: number
}

/**
 * Apply a centered rolling average to raw data.
 * Each output point is the average of data within ±windowMinutes/2 of the timestamp.
 * At edges (start/end of data), uses asymmetric window with available data.
 * Also computes rolling stddev for each metric.
 */
export function applyRollingAverage(data: AwairRecord[], windowMinutes: number): SmoothedRecord[] {
  if (windowMinutes <= 1 || data.length === 0) return data

  const halfWindowMs = (windowMinutes * 60 * 1000) / 2

  // Sort oldest-first for sliding window
  const sorted = [...data].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  // Two-pointer approach for O(n) centered window
  // Window contains indices [left, right) with timestamps in [T - halfWindow, T + halfWindow]
  let left = 0
  let right = 0
  let tempSum = 0, co2Sum = 0, humidSum = 0, pm25Sum = 0, vocSum = 0

  // Keep window values for stddev calculation (queue: front=left, back=right-1)
  const windowValues: { temp: number; co2: number; humid: number; pm25: number; voc: number }[] = []

  return sorted.map((record) => {
    const currentTime = new Date(record.timestamp).getTime()
    const windowStartTime = currentTime - halfWindowMs
    const windowEndTime = currentTime + halfWindowMs

    // Expand right to include all points with timestamp <= windowEndTime
    while (right < sorted.length) {
      const rightTime = new Date(sorted[right].timestamp).getTime()
      if (rightTime > windowEndTime) break
      const r = sorted[right]
      tempSum += r.temp
      co2Sum += r.co2
      humidSum += r.humid
      pm25Sum += r.pm25
      vocSum += r.voc
      windowValues.push({
        temp: r.temp,
        co2: r.co2,
        humid: r.humid,
        pm25: r.pm25,
        voc: r.voc,
      })
      right++
    }

    // Shrink left to exclude points with timestamp < windowStartTime
    while (left < right) {
      const leftTime = new Date(sorted[left].timestamp).getTime()
      if (leftTime >= windowStartTime) break
      const removed = windowValues.shift()!
      tempSum -= removed.temp
      co2Sum -= removed.co2
      humidSum -= removed.humid
      pm25Sum -= removed.pm25
      vocSum -= removed.voc
      left++
    }

    const count = windowValues.length

    // Edge case: no points in window (shouldn't happen)
    if (count === 0) {
      return {
        ...record,
        temp_stddev: 0,
        co2_stddev: 0,
        humid_stddev: 0,
        pm25_stddev: 0,
        voc_stddev: 0,
      }
    }

    // Compute means
    const tempMean = tempSum / count
    const co2Mean = co2Sum / count
    const humidMean = humidSum / count
    const pm25Mean = pm25Sum / count
    const vocMean = vocSum / count

    // Compute stddev (population stddev)
    let tempVariance = 0, co2Variance = 0, humidVariance = 0, pm25Variance = 0, vocVariance = 0
    for (const v of windowValues) {
      tempVariance += pow(v.temp - tempMean, 2)
      co2Variance += pow(v.co2 - co2Mean, 2)
      humidVariance += pow(v.humid - humidMean, 2)
      pm25Variance += pow(v.pm25 - pm25Mean, 2)
      vocVariance += pow(v.voc - vocMean, 2)
    }

    return {
      timestamp: record.timestamp,
      temp: tempMean,
      co2: co2Mean,
      humid: humidMean,
      pm10: record.pm10, // pm10 not smoothed (not displayed)
      pm25: pm25Mean,
      voc: vocMean,
      temp_stddev: sqrt(tempVariance / count),
      co2_stddev: sqrt(co2Variance / count),
      humid_stddev: sqrt(humidVariance / count),
      pm25_stddev: sqrt(pm25Variance / count),
      voc_stddev: sqrt(vocVariance / count),
    }
  })
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
// Accepts SmoothedRecord[] (with pre-computed rolling stddev) or plain AwairRecord[]
export function aggregateData(data: (AwairRecord | SmoothedRecord)[], windowMinutes: number): AggregatedData[] {
  if (data.length === 0) return []

  // For 1-minute windows, return raw data in the expected format
  // Sort ascending (oldest first) to match aggregated data behavior
  // If data has pre-computed rolling stddev, use it
  if (windowMinutes === 1) {
    const sortedData = [...data].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    return sortedData.map(record => {
      const smoothed = record as SmoothedRecord
      return {
        timestamp: record.timestamp,
        temp_avg: record.temp,
        temp_stddev: smoothed.temp_stddev ?? 0,
        co2_avg: record.co2,
        co2_stddev: smoothed.co2_stddev ?? 0,
        humid_avg: record.humid,
        humid_stddev: smoothed.humid_stddev ?? 0,
        pm25_avg: record.pm25,
        pm25_stddev: smoothed.pm25_stddev ?? 0,
        voc_avg: record.voc,
        voc_stddev: smoothed.voc_stddev ?? 0,
        count: 1,
      }
    })
  }

  const windowMs = windowMinutes * 60 * 1000
  const groups: { [key: string]: (AwairRecord | SmoothedRecord)[] } = {}

  // Group data by time windows
  data.forEach(record => {
    const timestamp = new Date(record.timestamp).getTime()
    const windowStart = floor(timestamp / windowMs) * windowMs
    const key = new Date(windowStart).toISOString()

    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(record)
  })

  // Calculate standard deviation (fallback when no pre-computed rolling stddev)
  const calculateStdDev = (values: number[]): number => {
    if (values.length <= 1) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(value => pow(value - mean, 2))
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
    return sqrt(avgSquaredDiff)
  }

  // Average pre-computed stddevs, or compute from values if not available
  const getStdDev = (
    records: (AwairRecord | SmoothedRecord)[],
    getValue: (r: AwairRecord) => number,
    getPrecomputed: (r: SmoothedRecord) => number | undefined
  ): number => {
    // Check if records have pre-computed rolling stddev
    const smoothed = records as SmoothedRecord[]
    const precomputed = smoothed.map(getPrecomputed).filter((v): v is number => v !== undefined)
    if (precomputed.length === records.length && precomputed.length > 0) {
      // Average the pre-computed rolling stddevs (preserves original variance)
      return precomputed.reduce((a, b) => a + b, 0) / precomputed.length
    }
    // Fall back to computing stddev of values
    return calculateStdDev(records.map(getValue))
  }

  // Aggregate each group and ensure chronological order
  return Object.entries(groups)
    .map(([timestampKey, records]) => {
      const temps = records.map(r => r.temp)
      const co2s = records.map(r => r.co2)
      const humids = records.map(r => r.humid)
      const pm25s = records.map(r => r.pm25)
      const vocs = records.map(r => r.voc)

      return {
        timestamp: new Date(timestampKey),
        temp_avg: temps.reduce((a, b) => a + b, 0) / temps.length,
        temp_stddev: getStdDev(records, r => r.temp, r => r.temp_stddev),
        co2_avg: co2s.reduce((a, b) => a + b, 0) / co2s.length,
        co2_stddev: getStdDev(records, r => r.co2, r => r.co2_stddev),
        humid_avg: humids.reduce((a, b) => a + b, 0) / humids.length,
        humid_stddev: getStdDev(records, r => r.humid, r => r.humid_stddev),
        pm25_avg: pm25s.reduce((a, b) => a + b, 0) / pm25s.length,
        pm25_stddev: getStdDev(records, r => r.pm25, r => r.pm25_stddev),
        voc_avg: vocs.reduce((a, b) => a + b, 0) / vocs.length,
        voc_stddev: getStdDev(records, r => r.voc, r => r.voc_stddev),
        count: records.length,
      }
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}

/**
 * Calculate responsive target points based on container width.
 * Mobile gets fewer points, desktop gets more.
 */
export function getTargetPoints(containerWidth?: number): number {
  if (!containerWidth) return 300
  // Scale from ~100 points at 375px to ~400 points at 1600px
  return max(100, min(400, floor(containerWidth / 4)))
}

/**
 * Get min/max point constraints based on container width.
 * Ensures windows aren't too sparse or dense for the display.
 */
function getPointConstraints(containerWidth?: number): { minPoints: number; maxPoints: number } {
  const target = getTargetPoints(containerWidth)
  return {
    minPoints: floor(target * 0.1),   // 10% of target (e.g., 30 for 300)
    maxPoints: floor(target * 5),      // 5x target (e.g., 1500 for 300)
  }
}

/**
 * Get valid window options for a given time range.
 * Filters to windows that produce reasonable point counts for the container.
 */
export function getValidWindows(timeRangeMinutes: number, containerWidth?: number): TimeWindow[] {
  const { minPoints, maxPoints } = getPointConstraints(containerWidth)
  return TIME_WINDOWS.filter(window => {
    const estimatedPoints = ceil(timeRangeMinutes / window.minutes)
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
      const estimatedPoints = ceil(timeRangeMinutes / window.minutes)
      // Log difference between actual and target points
      const logDiff = abs(Math.log(estimatedPoints) - Math.log(targetPoints))

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
      const estimatedPoints = ceil(totalMinutes / window.minutes)

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
    return TIME_WINDOWS[floor(TIME_WINDOWS.length / 2)]
  }
}

export interface UseDataAggregationOptions {
  containerWidth: number
  overrideWindow?: TimeWindow
  targetPx?: number | null  // Target pixels per point (null = use overrideWindow)
}

/**
 * Get the optimal window for a given duration and options.
 * Useful for computing window size before full aggregation.
 */
export function getWindowForDuration(
  durationMs: number,
  options: UseDataAggregationOptions,
): TimeWindow {
  const { containerWidth, overrideWindow, targetPx } = options
  const targetPoints = (targetPx && containerWidth)
    ? floor(containerWidth / targetPx)
    : getTargetPoints(containerWidth)
  const timeRangeMinutes = durationMs / (1000 * 60)
  return findOptimalWindow(timeRangeMinutes, undefined, targetPoints, overrideWindow)
}

export function useDataAggregation(
  data: AwairRecord[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions,
) {
  const { containerWidth, overrideWindow, targetPx } = options
  const rangeKey = xAxisRange ? `${xAxisRange[0]}-${xAxisRange[1]}` : 'null'
  // If targetPx is set, calculate target points from container width
  // Otherwise fall back to the old responsive calculation
  const targetPoints = (targetPx && containerWidth)
    ? floor(containerWidth / targetPx)
    : getTargetPoints(containerWidth)

  const { dataToAggregate, selectedWindow, validWindows } = useMemo(() => {
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
