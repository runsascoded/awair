import React from 'react'
import { Tooltip } from './Tooltip'
import { formatDuration } from '../hooks/useTimeRangeParam'
import type { DataSummary } from '../types/awair'

interface RangeWidthControlProps {
  getActiveTimeRange: () => string
  handleTimeRangeButtonClick: (hours: number) => void
  handleAllButtonClick: () => void
  latestModeIntended: boolean
  handleLatestButtonClick: () => void
  xAxisRange: [string, string] | null
  formatCompactDate: (date: Date) => string
  formatFullDate: (date: Date) => string
  summary: DataSummary | null
  duration: number
}

const timeRangeOptions = [
  { label: '12h', hours: 12 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 24 * 3 },
  { label: '7d', hours: 24 * 7 },
  { label: '14d', hours: 24 * 14 },
  { label: '30d', hours: 24 * 30 },
  { label: 'All', hours: -1 } // Special value for "All"
]

export function RangeWidthControl({
  getActiveTimeRange,
  handleTimeRangeButtonClick,
  handleAllButtonClick,
  latestModeIntended,
  handleLatestButtonClick,
  xAxisRange,
  formatCompactDate: _formatCompactDate,
  formatFullDate,
  summary: _summary,
  duration,
}: RangeWidthControlProps) {
  const activeRange = getActiveTimeRange()

  // Get custom duration label if not at a preset
  const customLabel = formatDuration(duration)

  const rangeText = xAxisRange
    ? `${formatFullDate(new Date(xAxisRange[0]))} → ${formatFullDate(new Date(xAxisRange[1]))}`
    : 'All data'

  const tooltipContent = <div><ul>
    <li><b>Current:</b> {rangeText}</li>
    <li><b>▶|:</b> "Latest" mode; auto-follow newest data (hotkey: l)</li>
    <li><b>Hotkeys:</b> 1=12h, 2=1d, 3=3d, 4=7d, 5=14d, 6=30d, 0=All</li>
  </ul></div>

  return (
    <div className="control-group range-width-section no-footer">
      {/* Row 1: Label */}
      <div className="header">
        <label className="unselectable">X Range:</label>
        <Tooltip content={tooltipContent}>
          <span className="info-icon">?</span>
        </Tooltip>
      </div>

      {/* Row 2: Duration dropdown + Latest checkbox */}
      <div className="body time-range-select">
        <select
          value={customLabel ? 'custom' : (activeRange.startsWith('latest-') ? activeRange.slice(7) : activeRange)}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'all') {
              handleAllButtonClick()
            } else if (value === 'custom') {
              // Custom option selected - no action (it's just for display)
            } else {
              const option = timeRangeOptions.find(opt => opt.label.toLowerCase() === value)
              if (option && option.hours > 0) {
                handleTimeRangeButtonClick(option.hours)
              }
            }
          }}
        >
          {(() => {
            // Build sorted options list, inserting custom duration in correct position
            const options = timeRangeOptions.map(opt => ({
              value: opt.label.toLowerCase(),
              label: opt.label,
              hours: opt.hours,
            }))

            if (customLabel) {
              const customHours = duration / (1000 * 60 * 60)
              // Find insertion point (before first option with hours > customHours, or before All)
              const insertIdx = options.findIndex(opt =>
                opt.hours === -1 || (opt.hours > 0 && opt.hours > customHours)
              )
              options.splice(insertIdx === -1 ? options.length - 1 : insertIdx, 0, {
                value: 'custom',
                label: customLabel,
                hours: customHours,
              })
            }

            return options.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))
          })()}
        </select>

        <Tooltip content="Latest mode: auto-follow newest data (l)">
          <label className="checkbox-label latest-checkbox">
            <input
              type="checkbox"
              checked={latestModeIntended}
              onChange={handleLatestButtonClick}
            />
            <i className="fas fa-forward-step"></i>
          </label>
        </Tooltip>
      </div>
    </div>
  )
}
