import {
  flattenDateAll,
  useMultiSeriesAggregation,
  type WindowConfig,
} from '@rdub/agg-plot'
import { getTargetPoints } from './useDataAggregation'
import type { AggregatedData, TimeWindow, UseDataAggregationOptions } from './useDataAggregation'
import type { DeviceDataResult } from '../components/DevicePoller'

const MS_PER_MIN = 60_000
const toMin = (ms: number) => ms / MS_PER_MIN
const toAwairWindow = (w: WindowConfig): TimeWindow => ({ label: w.label, minutes: toMin(w.size) })

const METRICS = ['temp', 'co2', 'humid', 'pm25', 'voc'] as const

export interface DeviceAggregatedData {
  deviceId: number
  deviceName: string
  aggregatedData: AggregatedData[]
  smoothedData: AggregatedData[] | null
  isRawData: boolean
}

interface MultiDeviceAggregationResult {
  deviceAggregations: DeviceAggregatedData[]
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  isRawData: boolean
}

export function useMultiDeviceAggregation(
  deviceDataResults: DeviceDataResult[],
  devices: { deviceId: number; name: string }[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions,
  smoothingMinutes: number = 1,
): MultiDeviceAggregationResult {
  const { containerWidth, overrideWindow, targetPx } = options

  // Convert xAxisRange to numeric range
  const xRange: [number, number] | null = xAxisRange
    ? [new Date(xAxisRange[0]).getTime(), new Date(xAxisRange[1]).getTime()]
    : null

  // Use agg-plot's useMultiSeriesAggregation
  const result = useMultiSeriesAggregation({
    series: deviceDataResults.map(r => ({
      id: r.deviceId,
      name: devices.find(d => d.deviceId === r.deviceId)?.name ?? `Device ${r.deviceId}`,
      data: r.data,
    })),
    getX: d => new Date(d.timestamp).getTime(),
    metrics: [...METRICS],
    getValue: (d, m) => d[m as keyof typeof d] as number,
    containerWidth,
    targetPxPerPoint: targetPx ?? (containerWidth / getTargetPoints(containerWidth)),
    fixedWindowSize: overrideWindow ? overrideWindow.minutes * MS_PER_MIN : undefined,
    smoothingWindowSize: smoothingMinutes > 1 ? smoothingMinutes * MS_PER_MIN : 0,
    xRange,
    gapThreshold: 3,
  })

  const selectedWindow = toAwairWindow(result.window)
  const isRawData = selectedWindow.minutes === 1

  // Convert to awair's DeviceAggregatedData format
  const deviceAggregations: DeviceAggregatedData[] = result.series.map(s => ({
    deviceId: s.id as number,
    deviceName: s.name,
    aggregatedData: flattenDateAll(s.aggregated, [...METRICS]) as unknown as AggregatedData[],
    smoothedData: s.smoothed ? flattenDateAll(s.smoothed, [...METRICS]) as unknown as AggregatedData[] : null,
    isRawData,
  }))

  return {
    deviceAggregations,
    selectedWindow,
    validWindows: result.validWindows.map(toAwairWindow),
    isRawData,
  }
}
