import { KbdModal } from 'use-kbd'
import { IntervalSelect } from './IntervalSelect'
import { Tooltip } from './Tooltip'
import { SMOOTHING_PRESETS } from '../lib/urlParams'

interface SmoothingControlProps {
  smoothing: number
  onSmoothingChange: (smoothing: number) => void
}

// Convert presets to IntervalSelect format
const SMOOTHING_OPTIONS = SMOOTHING_PRESETS.map(minutes => ({
  label: minutes === 1 ? 'Off' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${minutes / 60}h` : `${minutes / 1440}d`,
  minutes,
}))

export function SmoothingControl({
  smoothing,
  onSmoothingChange,
}: SmoothingControlProps) {
  return (
    <div className="control-group smoothing-section no-footer">
      <div className="header">
        <label className="unselectable">Smoothing:</label>
        <Tooltip content={<ul>
          <li>Applies a centered rolling average to smooth fluctuations.</li>
          <li>Useful for seeing trends through HVAC cycling noise.</li>
          <li>Press <KbdModal /> for keyboard shortcuts (e.g., <code>4 H</code> for 4h)</li>
        </ul>}>
          <span className="info-icon">?</span>
        </Tooltip>
      </div>
      <div className="body">
        <IntervalSelect
          value={smoothing}
          options={SMOOTHING_OPTIONS}
          onChange={onSmoothingChange}
          className="smoothing-select"
          offValue={1}
          offLabel="Off"
        />
      </div>
    </div>
  )
}
