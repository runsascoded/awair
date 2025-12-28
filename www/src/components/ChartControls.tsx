import { AggregationControl } from './AggregationControl'
import { DevicesControl } from './DevicesControl'
import { RangeWidthControl } from './RangeWidthControl'
import { formatForPlotly } from "../utils/dateFormat"
import type { PxOption } from './AggregationControl'
import type { TimeWindow } from '../hooks/useDataAggregation'
import type { MetricsState } from "../hooks/useMetrics"
import type { Device } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'
import type { DeviceRenderStrategy, HsvConfig } from '../utils/deviceRenderStrategy'

interface MetricConfig {
  label: string
  shortLabel: string
  emoji: string
  unit: string
  color: string
  rangeFloor?: number  // Minimum value for non-auto-range mode (e.g., CO2 never goes below 400 ppm)
}

interface ChartControlsProps {
  metrics: MetricsState
  deviceRenderStrategy: DeviceRenderStrategy
  setDeviceRenderStrategy: (value: DeviceRenderStrategy) => void
  hsvConfig: HsvConfig
  setHsvConfig: (value: HsvConfig) => void
  xAxisRange: [string, string] | null
  setXAxisRange: (range: [string, string] | null) => void
  data: AwairRecord[]
  summary: DataSummary | null
  latestModeIntended: boolean
  setLatestModeIntended: (value: boolean) => void
  setDuration?: (duration: number) => void
  getActiveTimeRange: () => string
  handleTimeRangeClick: (hours: number) => void
  handleAllClick: () => void
  setRangeByWidth: (hours: number, centerTime?: Date) => void
  setIgnoreNextPanCheck: () => void
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
  // Aggregation control
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  onWindowChange: (window: TimeWindow | null) => void
  targetPx: PxOption | null
  onTargetPxChange: (px: PxOption | null) => void
  timeRangeMinutes?: number
  containerWidth?: number
}

const metricConfig = {
  temp: { label: 'Temperature', shortLabel: 'Temp', emoji: '🌡️', unit: '°F', color: '#ff6384' },
  co2: { label: 'CO₂', shortLabel: 'CO₂', emoji: '💨', unit: 'ppm', color: '#36a2eb', rangeFloor: 400 },
  humid: { label: 'Humidity', shortLabel: 'Hum.', emoji: '💦', unit: '%', color: '#4bc0c0' },
  pm25: { label: 'PM2.5', shortLabel: 'PM2.5', emoji: '🏭', unit: 'μg/m³', color: '#9966ff' },
  voc: { label: 'VOC', shortLabel: 'VOC', emoji: '🧪', unit: 'ppb', color: '#ff9f40' },
} as const satisfies Record<string, MetricConfig>

export type MetricKey = keyof typeof metricConfig

// Helper to safely get rangeFloor with fallback to 0
export const getRangeFloor = (metric: MetricKey): number => {
  const config = metricConfig[metric]
  return ('rangeFloor' in config) ? config.rangeFloor : 0
}

export function ChartControls({
  metrics: _metrics,
  deviceRenderStrategy,
  setDeviceRenderStrategy,
  hsvConfig,
  setHsvConfig,
  xAxisRange,
  setXAxisRange,
  data,
  summary,
  latestModeIntended,
  setLatestModeIntended,
  getActiveTimeRange,
  handleTimeRangeClick,
  handleAllClick,
  setRangeByWidth: _setRangeByWidth,
  setIgnoreNextPanCheck,
  setDuration,
  devices,
  selectedDeviceIds,
  onDeviceSelectionChange,
  selectedWindow,
  validWindows,
  onWindowChange,
  targetPx,
  onTargetPxChange,
  timeRangeMinutes,
  containerWidth,
}: ChartControlsProps) {
  const handleTimeRangeButtonClick = (hours: number) => {
    const activeRange = getActiveTimeRange()
    if (activeRange.startsWith('latest-') || activeRange === 'all') {
      // Stay anchored to latest
      handleTimeRangeClick(hours)
    } else if (xAxisRange && data.length > 0 && setDuration) {
      // Keep end time fixed, set requested duration (data fetch will get enough data)
      const durationMs = hours * 60 * 60 * 1000
      setDuration(durationMs)
    } else {
      handleTimeRangeClick(hours)
    }
  }

  const handleLatestButtonClick = () => {
    if (latestModeIntended) {
      // Toggle off Latest mode
      setLatestModeIntended(false)
    } else if (xAxisRange && data.length > 0) {
      // Jump to latest and enable Latest mode
      const rangeStart = new Date(xAxisRange[0])
      const rangeEnd = new Date(xAxisRange[1])
      const currentWidth = rangeEnd.getTime() - rangeStart.getTime()
      const latestTime = new Date(data[0].timestamp)
      const newStart = new Date(latestTime.getTime() - currentWidth)
      const newRange: [string, string] = [formatForPlotly(newStart), formatForPlotly(latestTime)]
      setIgnoreNextPanCheck() // Don't disable Latest mode for our own update
      setXAxisRange(newRange)
      setLatestModeIntended(true)
    }
  }

  return (
    <div className="controls">
      <DevicesControl
        devices={devices}
        selectedDeviceIds={selectedDeviceIds}
        onDeviceSelectionChange={onDeviceSelectionChange}
        deviceRenderStrategy={deviceRenderStrategy}
        setDeviceRenderStrategy={setDeviceRenderStrategy}
        hsvConfig={hsvConfig}
        setHsvConfig={setHsvConfig}
      />

      <RangeWidthControl
        getActiveTimeRange={getActiveTimeRange}
        handleTimeRangeButtonClick={handleTimeRangeButtonClick}
        handleAllClick={handleAllClick}
        latestModeIntended={latestModeIntended}
        handleLatestButtonClick={handleLatestButtonClick}
        xAxisRange={xAxisRange}
        summary={summary}
      />

      <AggregationControl
        selectedWindow={selectedWindow}
        validWindows={validWindows}
        onWindowChange={onWindowChange}
        targetPx={targetPx}
        onTargetPxChange={onTargetPxChange}
        timeRangeMinutes={timeRangeMinutes}
        containerWidth={containerWidth}
      />
    </div>
  )
}

export { metricConfig }
export type { MetricConfig }
