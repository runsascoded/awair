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
        smoothedData = aggregateData(smoothedInRange, selectedWindow.minutes)
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
