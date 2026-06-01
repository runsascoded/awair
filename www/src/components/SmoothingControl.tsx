import { KbdModal } from 'use-kbd'
import { IntervalSelect } from './IntervalSelect'
import { Tooltip } from './Tooltip'
import { SMOOTHING_AUTO, SMOOTHING_PRESETS } from '../lib/urlParams'

interface SmoothingControlProps {
  smoothing: number
  onSmoothingChange: (smoothing: number) => void
}

const formatPresetLabel = (minutes: number): string => {
  if (minutes === SMOOTHING_AUTO) return 'Auto'
  if (minutes === 1) return 'Off'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${minutes / 60}h`
  return `${minutes / 1440}d`
}

// Convert presets to IntervalSelect format
const SMOOTHING_OPTIONS = SMOOTHING_PRESETS.map(minutes => ({
  label: formatPresetLabel(minutes),
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
          <li><strong>Auto</strong>: window scales with the visible x-bin width (~50× bin) — picks a reasonable smoothing for any zoom level.</li>
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
