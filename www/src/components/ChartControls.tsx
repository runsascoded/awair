import React from 'react'
import { AggregationControl } from './AggregationControl'
import { DevicesControl } from './DevicesControl'
import { RangeWidthControl } from './RangeWidthControl'
import { YAxesControl } from './YAxesControl'
import type { PxOption } from './AggregationControl'
import type { HsvConfig } from './DeviceRenderSettings'
import type { TimeWindow } from '../hooks/useDataAggregation'
import type { MetricsState } from "../hooks/useMetrics.ts"
import type { Device } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'
import type { DeviceRenderStrategy } from '../utils/deviceRenderStrategy'

interface MetricConfig {
  label: string
  shortLabel: string
  emoji: string
  unit: string
  color: string
}

interface ChartControlsProps {
  metrics: MetricsState
  yAxisFromZero: boolean
  setYAxisFromZero: (value: boolean) => void
  deviceRenderStrategy: DeviceRenderStrategy
  setDeviceRenderStrategy: (value: DeviceRenderStrategy) => void
  hsvConfig: HsvConfig
  setHsvConfig: (value: HsvConfig) => void
  xAxisRange: [string, string] | null
  setXAxisRange: (range: [string, string] | null) => void
  setHasSetDefaultRange: (value: boolean) => void
  data: AwairRecord[]
  summary: DataSummary | null
  formatForPlotly: (date: Date) => string
  formatCompactDate: (date: Date) => string
  formatFullDate: (date: Date) => string
  latestModeIntended: boolean
  setLatestModeIntended: (value: boolean) => void
  setDuration?: (duration: number) => void
  timeRange?: { timestamp: Date | null; duration: number }
  setTimeRange?: (range: { timestamp: Date | null; duration: number }) => void
  getActiveTimeRange: () => string
  handleTimeRangeClick: (hours: number) => void
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

const metricConfig: { [key: string]: MetricConfig } = {
  temp: { label: 'Temperature', shortLabel: 'Temp', emoji: '🌡️', unit: '°F', color: '#ff6384' },
  co2: { label: 'CO₂', shortLabel: 'CO₂', emoji: '💨', unit: 'ppm', color: '#36a2eb' },
  humid: { label: 'Humidity', shortLabel: 'Hum.', emoji: '💦', unit: '%', color: '#4bc0c0' },
  pm25: { label: 'PM2.5', shortLabel: 'PM2.5', emoji: '🏭', unit: 'μg/m³', color: '#9966ff' },
  voc: { label: 'VOC', shortLabel: 'VOC', emoji: '🧪', unit: 'ppb', color: '#ff9f40' }
}

export function ChartControls({
  metrics,
  yAxisFromZero,
  setYAxisFromZero,
  deviceRenderStrategy,
  setDeviceRenderStrategy,
  hsvConfig,
  setHsvConfig,
  xAxisRange,
  setXAxisRange,
  setHasSetDefaultRange,
  data,
  summary,
  formatForPlotly,
  formatCompactDate,
  formatFullDate,
  latestModeIntended,
  setLatestModeIntended,
  getActiveTimeRange,
  handleTimeRangeClick,
  setRangeByWidth,
  setIgnoreNextPanCheck,
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

  const isMobile = window.innerWidth < 768 || window.innerHeight < 600

  const handleTimeRangeButtonClick = (hours: number) => {
    const activeRange = getActiveTimeRange()
    if (activeRange.startsWith('latest-') || activeRange === 'all') {
      // Stay anchored to latest
      handleTimeRangeClick(hours)
    } else if (xAxisRange && data.length > 0) {
      // Preserve current center
      const currentCenter = new Date((new Date(xAxisRange[0]).getTime() + new Date(xAxisRange[1]).getTime()) / 2)
      setRangeByWidth(hours, currentCenter)
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
      setHasSetDefaultRange(true)
      setLatestModeIntended(true)
    }
  }

  const handleAllButtonClick = () => {
    if (summary?.earliest && summary?.latest) {
      const earliest = new Date(summary.earliest)
      const latest = new Date(summary.latest)
      const durationMs = latest.getTime() - earliest.getTime()
      const hours = durationMs / (1000 * 60 * 60)
      // Use the same code path as other time range buttons
      handleTimeRangeClick(hours)
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

      <YAxesControl
        metrics={metrics}
        yAxisFromZero={yAxisFromZero}
        setYAxisFromZero={setYAxisFromZero}
        isMobile={isMobile}
      />

      <RangeWidthControl
        getActiveTimeRange={getActiveTimeRange}
        handleTimeRangeButtonClick={handleTimeRangeButtonClick}
        handleAllButtonClick={handleAllButtonClick}
        latestModeIntended={latestModeIntended}
        handleLatestButtonClick={handleLatestButtonClick}
        xAxisRange={xAxisRange}
        formatCompactDate={formatCompactDate}
        formatFullDate={formatFullDate}
        summary={summary}
        isMobile={isMobile}
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
