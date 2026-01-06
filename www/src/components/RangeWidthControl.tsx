import { KbdModal } from 'use-kbd'
import { Tooltip } from './Tooltip'
import { formatDuration } from '../hooks/useTimeRangeParam'
import { formatFullDate } from "../utils/dateFormat"
import type { DataSummary } from '../types/awair'

interface RangeWidthControlProps {
  getActiveTimeRange: () => string
  handleTimeRangeButtonClick: (hours: number) => void
  handleAllClick: () => void
  latestModeIntended: boolean
  handleLatestButtonClick: () => void
  xAxisRange: [string, string] | null
  summary: DataSummary | null
}

const timeRangeOptions = [
  { label: '6h', hours: 6 },
  { label: '12h', hours: 12 },
  { label: '1d', hours: 24 },
  { label: '3d', hours: 24 * 3 },
  { label: '7d', hours: 24 * 7 },
  { label: '14d', hours: 24 * 14 },
  { label: '1mo', hours: 24 * 31 },
  { label: '2mo', hours: 24 * 62 },
  { label: '3mo', hours: 24 * 92 },
  { label: 'All', hours: -1 } // Special value for "All"
]

export function RangeWidthControl({
  getActiveTimeRange,
  handleTimeRangeButtonClick,
  handleAllClick,
  latestModeIntended,
  handleLatestButtonClick,
  xAxisRange,
  summary: _summary,
}: RangeWidthControlProps) {
  const activeRange = getActiveTimeRange()

  // Calculate duration from xAxisRange
  const duration = xAxisRange
    ? new Date(xAxisRange[1]).getTime() - new Date(xAxisRange[0]).getTime()
    : 0

  // Get custom duration label if not at a preset
  const customLabel = duration ? formatDuration(duration) : null

  const rangeText = xAxisRange
    ? `${formatFullDate(new Date(xAxisRange[0]))} → ${formatFullDate(new Date(xAxisRange[1]))}`
    : 'All data'

  const tooltipContent = <ul>
    <li><b>Current:</b> {rangeText}</li>
    <li><b>▶|:</b> "Latest" mode; auto-follow newest data</li>
    <li>Press <KbdModal /> for keyboard shortcuts</li>
  </ul>

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
              handleAllClick()
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

        <button
          className={`latest-btn${latestModeIntended ? ' active' : ''}`}
          onClick={handleLatestButtonClick}
        >
          <i className="fas fa-forward-step"></i>
        </button>
      </div>
    </div>
  )
}
