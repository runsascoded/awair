import React from 'react'
import { Tooltip } from './Tooltip'
import { MAX_SELECTED_DEVICES } from '../utils/colorUtils'
import type { Device } from '../services/awairService'
import type { AwairRecord, DataSummary } from '../types/awair'

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

const timeRangeButtons = [
  { label: '1d', hours: 24 },
  { label: '3d', hours: 24 * 3 },
  { label: '7d', hours: 24 * 7 },
  { label: '14d', hours: 24 * 14 },
  { label: '30d', hours: 24 * 30 }
]

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
      {devices.length > 1 && (
        <div className="control-group">
          <label className="unselectable">Devices:</label>
          <div className="device-checkboxes">
            {devices.map((device) => {
              const isChecked = selectedDeviceIds.includes(device.deviceId)
              const isDisabled = !isChecked && selectedDeviceIds.length >= MAX_SELECTED_DEVICES
              return (
                <label
                  key={device.deviceId}
                  className={`device-checkbox ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={(e) => {
                      if (e.target.checked) {
                        onDeviceSelectionChange([...selectedDeviceIds, device.deviceId])
                      } else {
                        // Don't allow unchecking the last device
                        if (selectedDeviceIds.length > 1) {
                          onDeviceSelectionChange(selectedDeviceIds.filter(id => id !== device.deviceId))
                        }
                      }
                    }}
                  />
                  <span className="device-name">{device.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <div className="control-group yaxes-group">
        <label className="unselectable">Y-axes:</label>
        <div className="yaxes-controls">
          <div className="metric-select">
            {isMobile ? (
              <label className="unselectable metric-side-label">L:</label>
            ) : (
              <Tooltip content="Left Y-axis metric (Keyboard: t=Temp, c=CO₂, h=Humid, p=PM2.5, v=VOC)">
                <label className="unselectable metric-side-label">L:</label>
              </Tooltip>
            )}
            <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
              {Object.entries(metricConfig).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.emoji} {cfg.shortLabel}</option>
              ))}
            </select>
          </div>

          <div className="metric-select">
            {isMobile ? (
              <label className="unselectable metric-side-label">R:</label>
            ) : (
              <Tooltip content="Right Y-axis metric (Keyboard: Shift+T, Shift+C, Shift+H, Shift+P, Shift+V, Shift+N=None)">
                <label className="unselectable metric-side-label">R:</label>
              </Tooltip>
            )}
            <select value={secondaryMetric} onChange={(e) => setSecondaryMetric(e.target.value as any)}>
              <option value="none">None</option>
              {Object.entries(metricConfig).map(([key, cfg]) => (
                key !== metric ? <option key={key} value={key}>{cfg.emoji} {cfg.shortLabel}</option> : null
              ))}
            </select>
          </div>

          {isMobile ? (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={yAxisFromZero}
                onChange={(e) => setYAxisFromZero(e.target.checked)}
              />
              <span>≥0</span>
            </label>
          ) : (
            <Tooltip content="Start Y-axes from zero (Keyboard: z)">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={yAxisFromZero}
                  onChange={(e) => setYAxisFromZero(e.target.checked)}
                />
                <span>≥0</span>
              </label>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="control-group">
        {isMobile ? (
          <label className="unselectable">Range Width:</label>
        ) : (
          <Tooltip content="Keyboard: 1=1day, 3=3days, 7=7days, 2=14days(2wk), m=30days, a=All">
            <label className="unselectable">Range Width:</label>
          </Tooltip>
        )}
        <div className="time-range-buttons">
          {timeRangeButtons.map(({ label, hours }) => (
            <button
              key={label}
              className={`unselectable ${getActiveTimeRange() === label || getActiveTimeRange() === `latest-${label}` ? 'active' : ''}`}
              onClick={() => handleTimeRangeButtonClick(hours)}
            >
              {label}
            </button>
          ))}
          <button
            className={`unselectable ${getActiveTimeRange() === 'all' ? 'active' : ''}`}
            onClick={handleAllButtonClick}
          >
            All
          </button>
        </div>
      </div>

      <div className="control-group">
        <Tooltip content={summary ? `Date Range: ${summary.dateRange}${summary.latest ? ` | Latest: ${formatCompactDate(new Date(summary.latest))}` : ''}` : 'Show all data'}>
          <label className="unselectable">Range:</label>
        </Tooltip>
        <div className="range-info">
          {xAxisRange ? (
            <Tooltip content={`${formatFullDate(new Date(xAxisRange[0]))} → ${formatFullDate(new Date(xAxisRange[1]))}`}>
              <div className="range-display">
                <span className="range-start">{formatCompactDate(new Date(xAxisRange[0]))}</span>
                <span className="range-separator"> → </span>
                <span className="range-end">{formatCompactDate(new Date(xAxisRange[1]))}</span>
              </div>
            </Tooltip>
          ) : (
            <span className="range-display">All data</span>
          )}
          {isMobile ? (
            <button
              className={`unselectable latest-button ${latestModeIntended || getActiveTimeRange().startsWith('latest-') || getActiveTimeRange() === 'all' ? 'active' : ''}`}
              onClick={handleLatestButtonClick}
            >
              Latest
            </button>
          ) : (
            <Tooltip content="Jump to latest data (Keyboard: l)">
              <button
                className={`unselectable latest-button ${latestModeIntended || getActiveTimeRange().startsWith('latest-') || getActiveTimeRange() === 'all' ? 'active' : ''}`}
                onClick={handleLatestButtonClick}
              >
                Latest
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

export { metricConfig }
export type { MetricConfig }
