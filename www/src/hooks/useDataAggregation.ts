import { useMemo } from 'react'
import type { AwairRecord } from '../types/awair'

interface TimeWindow {
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
}

const TIME_WINDOWS: TimeWindow[] = [
  { label: '1m', minutes: 1 },
  { label: '2m', minutes: 2 },
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '6h', minutes: 360 },
  { label: '12h', minutes: 720 },
  { label: '1d', minutes: 1440 },
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
      }
    })
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

// Find the optimal aggregation window size to keep around 300 data points
// This ensures good performance while maintaining visual detail
function findOptimalWindow(_dataLength: number, timeRangeMinutes?: number, data?: AwairRecord[]): TimeWindow {
  const targetPoints = 300

  if (timeRangeMinutes) {
    // When zoomed: calculate window size based on visible time range
    // Go from smallest to largest to find the smallest window that keeps us under target
    for (let i = 0; i < TIME_WINDOWS.length; i++) {
      const window = TIME_WINDOWS[i]
      const estimatedPoints = Math.ceil(timeRangeMinutes / window.minutes)

      if (estimatedPoints <= targetPoints) {
        return window
      }
    }

    // If even the largest window gives too many points, use it anyway
    return TIME_WINDOWS[TIME_WINDOWS.length - 1]
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

export function useDataAggregation(data: AwairRecord[], xAxisRange: [string, string] | null) {
  const rangeKey = xAxisRange ? `${xAxisRange[0]}-${xAxisRange[1]}` : 'null'

  const { dataToAggregate, selectedWindow } = useMemo(() => {
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
    }

    const selectedWindow = findOptimalWindow(dataToAggregate.length, timeRangeMinutes, data)

    return {
      dataToAggregate,
      selectedWindow
    }
  }, [data, rangeKey])

  const aggregatedData = useMemo(() => {
    return aggregateData(dataToAggregate, selectedWindow.minutes)
  }, [dataToAggregate, selectedWindow.minutes])

  return {
    aggregatedData,
    selectedWindow,
    isRawData: selectedWindow.minutes === 1
  }
}

export type { AggregatedData, TimeWindow }
