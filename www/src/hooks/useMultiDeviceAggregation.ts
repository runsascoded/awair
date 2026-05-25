import {
  flattenDateAll,
  useMultiSeriesAggregation,
  type WindowConfig,
} from 'pltly'
import { getTargetPoints } from './useDataAggregation'
import type { AggregatedData, TimeWindow, UseDataAggregationOptions } from './useDataAggregation'
import type { DeviceDataResult } from '../components/DevicePoller'
import type { AwairRecord } from '../types/awair'

const MS_PER_MIN = 60_000
const toMin = (ms: number) => ms / MS_PER_MIN
const toAwairWindow = (w: WindowConfig): TimeWindow => ({ label: w.label, minutes: toMin(w.size) })

/**
 * Estimate input data's bin width from the first ~100 inter-row gaps. Returns
 * `undefined` if there isn't enough data or spacing is too irregular to be
 * meaningful. Used to keep the chart's aggregation window from going *finer*
 * than the source's actual bin width (e.g. pyrmts returning 30-min bins for a
 * coarser tier — the chart's auto-pick of a 5-min window would otherwise drop
 * all points as gaps).
 */
function detectInputBinMs(records: AwairRecord[]): number | undefined {
  if (records.length < 10) return undefined
  const gaps: number[] = []
  const upTo = Math.min(records.length, 100)
  for (let i = 1; i < upTo; i++) {
    const g = new Date(records[i].timestamp).getTime() - new Date(records[i - 1].timestamp).getTime()
    if (g > 0) gaps.push(g)
  }
  if (gaps.length === 0) return undefined
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

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

  // If the source pre-bins data (e.g. pyrmts returning a coarser tier than
  // 1-min raw), force the aggregation window to at least that bin size — else
  // the auto-pick would land on a finer window and `useMultiSeriesAggregation`
  // would drop everything as gaps. User-set overrideWindow takes priority.
  let effectiveOverrideWindow = overrideWindow
  if (!overrideWindow) {
    const inputBinMs = deviceDataResults
      .map(r => detectInputBinMs(r.data))
      .filter((m): m is number => m !== undefined)
      .reduce<number | undefined>((acc, m) => (acc === undefined ? m : Math.max(acc, m)), undefined)
    if (inputBinMs !== undefined && inputBinMs > MS_PER_MIN) {
      effectiveOverrideWindow = { label: `${toMin(inputBinMs)}m`, minutes: toMin(inputBinMs) }
    }
  }

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
    fixedWindowSize: effectiveOverrideWindow ? effectiveOverrideWindow.minutes * MS_PER_MIN : undefined,
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
