import React from 'react'
import { Tooltip } from './Tooltip'
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
}: RangeWidthControlProps) {
  const activeRange = getActiveTimeRange()

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
          value={activeRange.startsWith('latest-') ? activeRange.slice(7) : activeRange}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'all') {
              handleAllButtonClick()
            } else {
              const option = timeRangeOptions.find(opt => opt.label === value)
              if (option && option.hours > 0) {
                handleTimeRangeButtonClick(option.hours)
              }
            }
          }}
        >
          {timeRangeOptions.map(({ label }) => (
            <option key={label} value={label.toLowerCase()}>
              {label}
            </option>
          ))}
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
