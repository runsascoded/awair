import { useMemo } from 'react'
import { useDataAggregation } from './useDataAggregation'
import type { AggregatedData, TimeWindow, UseDataAggregationOptions } from './useDataAggregation'
import type { DeviceDataResult } from './useMultiDeviceData'
import type { AwairRecord } from '../types/awair'

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

// Copy of aggregateData from useDataAggregation (to avoid circular deps)
function aggregateData(data: AwairRecord[], windowMinutes: number): AggregatedData[] {
  if (data.length === 0) return []

  if (windowMinutes === 1) {
    // Sort ascending (oldest first) to match aggregated data behavior
    const sortedData = [...data].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    return sortedData.map(record => ({
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
      pm10_avg: 0,
      pm10_stddev: 0,
      count: 1,
    }))
  }

  const windowMs = windowMinutes * 60 * 1000
  const groups: { [key: string]: AwairRecord[] } = {}

  data.forEach(record => {
    const timestamp = new Date(record.timestamp).getTime()
    const windowStart = Math.floor(timestamp / windowMs) * windowMs
    const key = new Date(windowStart).toISOString()

    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(record)
  })

  const calculateStdDev = (values: number[]): number => {
    if (values.length <= 1) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2))
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(avgSquaredDiff)
  }

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
        temp_stddev: calculateStdDev(temps),
        co2_avg: co2s.reduce((a, b) => a + b, 0) / co2s.length,
        co2_stddev: calculateStdDev(co2s),
        humid_avg: humids.reduce((a, b) => a + b, 0) / humids.length,
        humid_stddev: calculateStdDev(humids),
        pm25_avg: pm25s.reduce((a, b) => a + b, 0) / pm25s.length,
        pm25_stddev: calculateStdDev(pm25s),
        voc_avg: vocs.reduce((a, b) => a + b, 0) / vocs.length,
        voc_stddev: calculateStdDev(vocs),
        pm10_avg: 0,
        pm10_stddev: 0,
        count: records.length,
      }
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
