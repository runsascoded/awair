import {
  aggregate,
  flattenDateAll,
  rollingRaw,
  TIME_WINDOWS as AGG_TIME_WINDOWS,
  findOptimalWindow as aggFindOptimalWindow,
  getValidWindows as aggGetValidWindows,
  type WindowConfig,
} from '@rdub/agg-plot'
import { floor, max, min } from '@rdub/base'
import { useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

// ============================================================================
// Awair-specific interfaces (kept for backward compatibility)
// ============================================================================

export interface TimeWindow {
  label: string
  minutes: number
}

export interface AggregatedData {
  timestamp: Date
  temp_avg: number | null
  temp_stddev: number | null
  co2_avg: number | null
  co2_stddev: number | null
  humid_avg: number | null
  humid_stddev: number | null
  pm25_avg: number | null
  pm25_stddev: number | null
  voc_avg: number | null
  voc_stddev: number | null
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

// ============================================================================
// Constants and utilities
// ============================================================================

const MS_PER_MIN = 60_000
const toMs = (min: number) => min * MS_PER_MIN
const toMin = (ms: number) => ms / MS_PER_MIN

const METRICS = ['temp', 'co2', 'humid', 'pm25', 'voc'] as const

const getX = (d: AwairRecord) => new Date(d.timestamp).getTime()
const getValue = (d: AwairRecord, metric: string) => d[metric as keyof AwairRecord] as number

const toAwairWindow = (w: WindowConfig): TimeWindow => ({
  label: w.label,
  minutes: toMin(w.size),
})

/** awair TIME_WINDOWS derived from agg-plot's TIME_WINDOWS */
export const TIME_WINDOWS: TimeWindow[] = AGG_TIME_WINDOWS.map(toAwairWindow)

// ============================================================================
// Rolling average for raw data
// ============================================================================

/**
 * Apply a centered rolling average to raw data.
 */
export function applyRollingAverage(data: AwairRecord[], windowMinutes: number): SmoothedRecord[] {
  if (windowMinutes <= 1 || data.length === 0) return data

  const sorted = [...data].sort((a, b) => getX(a) - getX(b))

  return rollingRaw(sorted, {
    getX,
    metrics: [...METRICS],
    getValue,
    windowSize: toMs(windowMinutes),
    createOutput: (original, smoothed) => ({
      timestamp: original.timestamp,
      temp: smoothed.temp?.mean ?? original.temp,
      co2: smoothed.co2?.mean ?? original.co2,
      humid: smoothed.humid?.mean ?? original.humid,
      pm10: original.pm10,
      pm25: smoothed.pm25?.mean ?? original.pm25,
      voc: smoothed.voc?.mean ?? original.voc,
      temp_stddev: smoothed.temp?.stddev ?? 0,
      co2_stddev: smoothed.co2?.stddev ?? 0,
      humid_stddev: smoothed.humid?.stddev ?? 0,
      pm25_stddev: smoothed.pm25?.stddev ?? 0,
      voc_stddev: smoothed.voc?.stddev ?? 0,
    }),
  })
}

// ============================================================================
// Data aggregation
// ============================================================================

/**
 * Aggregate data into time windows for performance and visual clarity.
 */
export function aggregateData(
  data: (AwairRecord | SmoothedRecord)[],
  windowMinutes: number,
): AggregatedData[] {
  if (data.length === 0) return []

  // For 1-minute windows, return raw data in the expected format
  if (windowMinutes === 1) {
    const sortedData = [...data].sort((a, b) => getX(a) - getX(b))
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

  // Use agg-plot's aggregate + flatten
  const aggregated = aggregate(data, {
    getX,
    metrics: [...METRICS],
    getValue,
    windowSize: toMs(windowMinutes),
    gapThreshold: 3,
  })

  return flattenDateAll(aggregated, [...METRICS]) as unknown as AggregatedData[]
}

// ============================================================================
// Target points and window selection
// ============================================================================

export function getTargetPoints(containerWidth?: number): number {
  if (!containerWidth) return 300
  return max(100, min(400, floor(containerWidth / 4)))
}

export function getValidWindows(timeRangeMinutes: number, containerWidth?: number): TimeWindow[] {
  const targetPoints = getTargetPoints(containerWidth)
  return aggGetValidWindows(AGG_TIME_WINDOWS, toMs(timeRangeMinutes), targetPoints).map(toAwairWindow)
}

export function findOptimalWindow(
  timeRangeMinutes?: number,
  data?: AwairRecord[],
  targetPoints: number = 300,
  overrideWindow?: TimeWindow,
): TimeWindow {
  if (overrideWindow) return overrideWindow

  let dataRangeMs: number
  if (timeRangeMinutes) {
    dataRangeMs = toMs(timeRangeMinutes)
  } else if (data && data.length > 1) {
    dataRangeMs = Math.abs(getX(data[0]) - getX(data[data.length - 1]))
  } else {
    return TIME_WINDOWS[floor(TIME_WINDOWS.length / 2)]
  }

  return toAwairWindow(aggFindOptimalWindow(AGG_TIME_WINDOWS, dataRangeMs, targetPoints))
}

// ============================================================================
// Hook
// ============================================================================

export interface UseDataAggregationOptions {
  containerWidth: number
  overrideWindow?: TimeWindow
  targetPx?: number | null
}

export function getWindowForDuration(durationMs: number, options: UseDataAggregationOptions): TimeWindow {
  const { containerWidth, overrideWindow, targetPx } = options
  const targetPoints = (targetPx && containerWidth) ? floor(containerWidth / targetPx) : getTargetPoints(containerWidth)
  return findOptimalWindow(toMin(durationMs), undefined, targetPoints, overrideWindow)
}

export function useDataAggregation(
  data: AwairRecord[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions,
) {
  const { containerWidth, overrideWindow, targetPx } = options
  const rangeKey = xAxisRange ? `${xAxisRange[0]}-${xAxisRange[1]}` : 'null'
  const targetPoints = (targetPx && containerWidth) ? floor(containerWidth / targetPx) : getTargetPoints(containerWidth)

  const { dataToAggregate, selectedWindow, validWindows } = useMemo(() => {
    let dataToAggregate = data
    let timeRangeMinutes: number | undefined

    if (xAxisRange) {
      const startTime = new Date(xAxisRange[0]).getTime()
      const endTime = new Date(xAxisRange[1]).getTime()
      timeRangeMinutes = toMin(endTime - startTime)
      dataToAggregate = data.filter(d => {
        const ts = getX(d)
        return ts >= startTime && ts <= endTime
      })
    } else if (data.length > 1) {
      timeRangeMinutes = toMin(Math.abs(getX(data[0]) - getX(data[data.length - 1])))
    }

    return {
      dataToAggregate,
      selectedWindow: findOptimalWindow(timeRangeMinutes, data, targetPoints, overrideWindow),
      validWindows: timeRangeMinutes ? getValidWindows(timeRangeMinutes, containerWidth) : TIME_WINDOWS,
    }
  }, [data, rangeKey, targetPoints, overrideWindow, containerWidth])

  const aggregatedData = useMemo(
    () => aggregateData(dataToAggregate, selectedWindow.minutes),
    [dataToAggregate, selectedWindow.minutes]
  )

  return {
    aggregatedData,
    selectedWindow,
    validWindows,
    isRawData: selectedWindow.minutes === 1,
  }
}
