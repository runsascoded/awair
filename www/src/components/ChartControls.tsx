import React from 'react'
import type { Device } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'
import { DevicesControl } from './DevicesControl'
import { YAxesControl } from './YAxesControl'
import { RangeWidthControl } from './RangeWidthControl'
import { RangeControl } from './RangeControl'

interface MetricConfig {
  label: string
  shortLabel: string
  emoji: string
  unit: string
  color: string
}

interface ChartControlsProps {
  metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'
  secondaryMetric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none'
  setMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc') => void
  setSecondaryMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none') => void
  yAxisFromZero: boolean
  setYAxisFromZero: (value: boolean) => void
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
  getActiveTimeRange: () => string
  handleTimeRangeClick: (hours: number) => void
  setRangeByWidth: (hours: number, centerTime?: Date) => void
  setIgnoreNextPanCheck: () => void
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
}

const metricConfig: { [key: string]: MetricConfig } = {
  temp: { label: 'Temperature', shortLabel: 'Temp', emoji: '🌡️', unit: '°F', color: '#ff6384' },
  co2: { label: 'CO₂', shortLabel: 'CO₂', emoji: '💨', unit: 'ppm', color: '#36a2eb' },
  humid: { label: 'Humidity', shortLabel: 'Hum.', emoji: '💦', unit: '%', color: '#4bc0c0' },
  pm25: { label: 'PM2.5', shortLabel: 'PM2.5', emoji: '🏭', unit: 'μg/m³', color: '#9966ff' },
  voc: { label: 'VOC', shortLabel: 'VOC', emoji: '🧪', unit: 'ppb', color: '#ff9f40' }
}

export function ChartControls({
  metric,
  secondaryMetric,
  setMetric,
  setSecondaryMetric,
  yAxisFromZero,
  setYAxisFromZero,
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
  onDeviceSelectionChange
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
    if (data.length > 0) {
      // Explicitly set range to full data bounds
      const fullRange: [string, string] = [
        formatForPlotly(new Date(data[data.length - 1].timestamp)),
        formatForPlotly(new Date(data[0].timestamp))
      ]
      setXAxisRange(fullRange)
      setHasSetDefaultRange(true)
      setLatestModeIntended(true)
    } else {
      setXAxisRange(null)
    }
  }

  return (
    <div className="chart-controls">
      <DevicesControl
        devices={devices}
        selectedDeviceIds={selectedDeviceIds}
        onDeviceSelectionChange={onDeviceSelectionChange}
      />

      <YAxesControl
        metric={metric}
        secondaryMetric={secondaryMetric}
        setMetric={setMetric}
        setSecondaryMetric={setSecondaryMetric}
        yAxisFromZero={yAxisFromZero}
        setYAxisFromZero={setYAxisFromZero}
        isMobile={isMobile}
      />

      <RangeWidthControl
        getActiveTimeRange={getActiveTimeRange}
        handleTimeRangeButtonClick={handleTimeRangeButtonClick}
        handleAllButtonClick={handleAllButtonClick}
        isMobile={isMobile}
      />

      <RangeControl
        summary={summary}
        formatCompactDate={formatCompactDate}
        formatFullDate={formatFullDate}
        latestModeIntended={latestModeIntended}
        getActiveTimeRange={getActiveTimeRange}
        handleLatestButtonClick={handleLatestButtonClick}
        xAxisRange={xAxisRange}
        isMobile={isMobile}
      />
    </div>
  )
}

export { metricConfig }
export type { MetricConfig }
