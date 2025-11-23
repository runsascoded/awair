import React from 'react'
import { Tooltip } from './Tooltip'

interface RangeWidthControlProps {
  getActiveTimeRange: () => string
  handleTimeRangeButtonClick: (hours: number) => void
  handleAllButtonClick: () => void
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
  isMobile
}: RangeWidthControlProps) {
  return (
    <div className="control-group range-width-section">
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
  )
}
