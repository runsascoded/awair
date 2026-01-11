import { Tooltip } from './Tooltip'
import { SMOOTHING_OPTIONS } from '../lib/urlParams'
import type { SmoothingMinutes } from '../lib/urlParams'

interface SmoothingControlProps {
  smoothing: SmoothingMinutes
  onSmoothingChange: (smoothing: SmoothingMinutes) => void
}

const SMOOTHING_LABELS: Record<SmoothingMinutes, string> = {
  1: 'Off',
  5: '5m',
  10: '10m',
  15: '15m',
  30: '30m',
  60: '1h',
  120: '2h',
  240: '4h',
  360: '6h',
  720: '12h',
  1440: '1d',
}

export function SmoothingControl({
  smoothing,
  onSmoothingChange,
}: SmoothingControlProps) {
  return (
    <div className="control-group smoothing-section no-footer">
      <div className="header">
        <label className="unselectable">Smoothing:</label>
        <Tooltip content={<ul>
          <li>Applies a rolling average to smooth out short-term fluctuations.</li>
          <li>Useful for seeing trends through HVAC cycling noise.</li>
          <li>Each point becomes the average of the preceding N minutes.</li>
        </ul>}>
          <span className="info-icon">?</span>
        </Tooltip>
      </div>
      <div className="body smoothing-buttons">
        {SMOOTHING_OPTIONS.map(option => (
          <button
            key={option}
            className={`smoothing-btn${smoothing === option ? ' active' : ''}`}
            onClick={() => onSmoothingChange(option)}
          >
            {SMOOTHING_LABELS[option]}
          </button>
        ))}
      </div>
    </div>
  )
}
