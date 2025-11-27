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
  isMobile: boolean
}

const timeRangeButtons = [
  { label: '1d', hours: 24 },
  { label: '3d', hours: 24 * 3 },
  { label: '7d', hours: 24 * 7 },
  { label: '14d', hours: 24 * 14 },
  { label: '30d', hours: 24 * 30 }
]

export function RangeWidthControl({
  getActiveTimeRange,
  handleTimeRangeButtonClick,
  handleAllButtonClick,
  latestModeIntended,
  handleLatestButtonClick,
  xAxisRange,
  formatCompactDate,
  formatFullDate,
  summary: _summary,
  isMobile
}: RangeWidthControlProps) {
  return (
    <div className="control-group range-width-section">
      {/* Row 1: Label and Latest button */}
      <div className="header range-header-row">
        {isMobile ? (
          <label className="unselectable">X Range:</label>
        ) : (
          <Tooltip content="Keyboard: 1=1day, 3=3days, 7=7days, 2=14days(2wk), m=30days, a=All">
            <label className="unselectable">X Range:</label>
          </Tooltip>
        )}
        {isMobile ? (
          <label className="checkbox-label latest-checkbox">
            <input
              type="checkbox"
              checked={latestModeIntended}
              onChange={handleLatestButtonClick}
            />
            <span>Latest</span>
          </label>
        ) : (
          <Tooltip content="Auto-follow latest data (Keyboard: l)">
            <label className="checkbox-label latest-checkbox">
              <input
                type="checkbox"
                checked={latestModeIntended}
                onChange={handleLatestButtonClick}
              />
              <span>Latest</span>
            </label>
          </Tooltip>
        )}
      </div>

      {/* Row 2: Duration buttons */}
      <div className="body time-range-buttons">
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

      {/* Row 3: Current range display */}
      <div className="footer range-info">
        {xAxisRange ? (
          <Tooltip content={`${formatFullDate(new Date(xAxisRange[0]))} → ${formatFullDate(new Date(xAxisRange[1]))}`}>
            <div className="display">
              <span className="start">{formatCompactDate(new Date(xAxisRange[0]))}</span>
              <span className="separator"> → </span>
              <span className="end">{formatCompactDate(new Date(xAxisRange[1]))}</span>
            </div>
          </Tooltip>
        ) : (
          <span className="display">All data</span>
        )}
      </div>
    </div>
  )
}
