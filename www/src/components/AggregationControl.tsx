import type { TimeWindow } from '../hooks/useDataAggregation'

interface AggregationControlProps {
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  windowCount: number
  onWindowChange: (window: TimeWindow | null) => void
  isAutoMode: boolean
}

export function AggregationControl({
  selectedWindow,
  validWindows,
  windowCount,
  onWindowChange,
  isAutoMode,
}: AggregationControlProps) {
  return (
    <div className="control-group aggregation-section no-footer">
      <div className="header">
        <label className="unselectable">Aggregation:</label>
      </div>
      <div className="body">
        <select
          value={isAutoMode ? 'auto' : selectedWindow.label}
          onChange={(e) => {
            if (e.target.value === 'auto') {
              onWindowChange(null)
            } else {
              const window = validWindows.find(w => w.label === e.target.value)
              if (window) onWindowChange(window)
            }
          }}
        >
          <option value="auto">Auto ({selectedWindow.label})</option>
          {validWindows.map(w => (
            <option key={w.label} value={w.label}>{w.label}</option>
          ))}
        </select>
        <span className="info-text">
          {windowCount} windows
        </span>
      </div>
    </div>
  )
}
