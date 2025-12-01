import { useMemo } from 'react'
import { useDataAggregation, aggregateData } from './useDataAggregation'
import type { AggregatedData, TimeWindow, UseDataAggregationOptions } from './useDataAggregation'
import type { DeviceDataResult } from './useMultiDeviceData'

export interface DeviceAggregatedData {
  deviceId: number
  deviceName: string
  aggregatedData: AggregatedData[]
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
 */
export function useMultiDeviceAggregation(
  deviceDataResults: DeviceDataResult[],
  devices: { deviceId: number; name: string }[],
  xAxisRange: [string, string] | null,
  options: UseDataAggregationOptions = {}
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

      // Filter and aggregate this device's data
      let dataToAggregate = result.data

      if (xAxisRange) {
        const startTime = new Date(xAxisRange[0]).getTime()
        const endTime = new Date(xAxisRange[1]).getTime()
        dataToAggregate = result.data.filter(d => {
          const timestamp = new Date(d.timestamp).getTime()
          return timestamp >= startTime && timestamp <= endTime
        })
      }

      const aggregatedData = aggregateData(dataToAggregate, selectedWindow.minutes)

      return {
        deviceId: result.deviceId,
        deviceName,
        aggregatedData,
        isRawData,
      }
    })
  }, [deviceDataResults, devices, xAxisRange, selectedWindow.minutes, isRawData])

  return {
    deviceAggregations,
    selectedWindow,
    validWindows,
    isRawData,
  }
}
