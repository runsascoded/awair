import React from 'react'
import { Tooltip } from './Tooltip'
import type { DataSummary } from '../types/awair'

interface RangeControlProps {
  summary: DataSummary | null
  formatCompactDate: (date: Date) => string
  formatFullDate: (date: Date) => string
  latestModeIntended: boolean
  getActiveTimeRange: () => string
  handleLatestButtonClick: () => void
  xAxisRange: [string, string] | null
  isMobile: boolean
}

export function RangeControl({
  summary,
  formatCompactDate,
  formatFullDate,
  latestModeIntended,
  getActiveTimeRange,
  handleLatestButtonClick,
  xAxisRange,
  isMobile
}: RangeControlProps) {
  return (
    <div className="control-group range-group range-section">
      <div className="range-label-row">
        <Tooltip content={summary ? `Date Range: ${summary.dateRange}${summary.latest ? ` | Latest: ${formatCompactDate(new Date(summary.latest))}` : ''}` : 'Show all data'}>
          <label className="unselectable">Range:</label>
        </Tooltip>
        {isMobile ? (
          <button
            className={`unselectable latest-button ${latestModeIntended ? 'active' : ''}`}
            onClick={handleLatestButtonClick}
          >
            Latest
          </button>
        ) : (
          <Tooltip content="Jump to latest data and auto-follow new data (Keyboard: l)">
            <button
              className={`unselectable latest-button ${latestModeIntended ? 'active' : ''}`}
              onClick={handleLatestButtonClick}
            >
              Latest
            </button>
          </Tooltip>
        )}
      </div>
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
      </div>
    </div>
  )
}
