import { useMemo } from 'react'
import { useDataAggregation, aggregateData, applyRollingAverage } from './useDataAggregation'
import type { AggregatedData, TimeWindow, UseDataAggregationOptions } from './useDataAggregation'
import type { DeviceDataResult } from '../components/DevicePoller'

export interface DeviceAggregatedData {
  deviceId: number
  deviceName: string
  aggregatedData: AggregatedData[]       // Raw/unsmoothed data
  smoothedData: AggregatedData[] | null  // Smoothed overlay (when smoothing > 1)
  isRawData: boolean
}

interface MultiDeviceAggregationResult {
  deviceAggregations: DeviceAggregatedData[]
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  isRawData: boolean
}

/**
 * Aggregates data for multiple devices using a shared time window.
 * The window is determined by the combined data range.
 * Optional smoothing applies a rolling average before aggregation.
 */
export function useMultiDeviceAggregation(
  deviceDataResults: DeviceDataResult[],
  devices: { deviceId: number; name: string }[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions,
  smoothingMinutes: number = 1,
): MultiDeviceAggregationResult {
  // Combine all data to determine optimal window
  const allData = useMemo(() => {
    return deviceDataResults
      .flatMap(r => r.data)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [deviceDataResults])

  // Use combined data for window selection
  const { selectedWindow, validWindows, isRawData } = useDataAggregation(allData, xAxisRange, options)

  // Now aggregate each device's data using the same window
  const deviceAggregations = useMemo(() => {
    return deviceDataResults.map(result => {
      const device = devices.find(d => d.deviceId === result.deviceId)
      const deviceName = device?.name || `Device ${result.deviceId}`

      // Filter raw data to time range
      let rawDataInRange = result.data
      if (xAxisRange) {
        const startTime = new Date(xAxisRange[0]).getTime()
        const endTime = new Date(xAxisRange[1]).getTime()
        rawDataInRange = result.data.filter(d => {
          const timestamp = new Date(d.timestamp).getTime()
          return timestamp >= startTime && timestamp <= endTime
        })
      }

      // Aggregate raw data
      const aggregatedData = aggregateData(rawDataInRange, selectedWindow.minutes)

      // Apply smoothing for overlay (on full data for accurate edge values, then filter)
      let smoothedData: AggregatedData[] | null = null
      if (smoothingMinutes > 1) {
        const smoothedRecords = applyRollingAverage(result.data, smoothingMinutes)
        let smoothedInRange = smoothedRecords
        if (xAxisRange) {
          const startTime = new Date(xAxisRange[0]).getTime()
          const endTime = new Date(xAxisRange[1]).getTime()
          smoothedInRange = smoothedRecords.filter(d => {
            const timestamp = new Date(d.timestamp).getTime()
            return timestamp >= startTime && timestamp <= endTime
          })
        }
        const rawSmoothedData = aggregateData(smoothedInRange, selectedWindow.minutes)

        // Detect gap time ranges from the raw aggregated data
        // A gap is detected when consecutive real data points (count > 0) have a large time gap
        const realPoints = aggregatedData.filter(d => d.count > 0)
        const gapRanges: Array<{ start: number; end: number }> = []
        const gapThresholdMs = selectedWindow.minutes * 60 * 1000 * 3

        for (let i = 0; i < realPoints.length - 1; i++) {
          const current = realPoints[i].timestamp.getTime()
          const next = realPoints[i + 1].timestamp.getTime()
          if (next - current > gapThresholdMs) {
            gapRanges.push({ start: current, end: next })
          }
        }

        // Null out smoothed points that fall within any gap range
        smoothedData = rawSmoothedData.map(d => {
          const ts = d.timestamp.getTime()
          for (const gap of gapRanges) {
            if (ts > gap.start && ts < gap.end) {
              return {
                ...d,
                temp_avg: null,
                temp_stddev: null,
                co2_avg: null,
                co2_stddev: null,
                humid_avg: null,
                humid_stddev: null,
                pm25_avg: null,
                pm25_stddev: null,
                voc_avg: null,
                voc_stddev: null,
                count: 0,
              }
            }
          }
          return d
        })
      }

      return {
        deviceId: result.deviceId,
        deviceName,
        aggregatedData,
        smoothedData,
        isRawData,
      }
    })
  }, [deviceDataResults, devices, xAxisRange, selectedWindow.minutes, isRawData, smoothingMinutes])

  return {
    deviceAggregations,
    selectedWindow,
    validWindows,
    isRawData,
  }
}
