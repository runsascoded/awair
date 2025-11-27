import type { TimeWindow } from '../hooks/useDataAggregation'

interface AggregationControlProps {
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  onWindowChange: (window: TimeWindow | null) => void
  isAutoMode: boolean
  timeRangeMinutes?: number
  containerWidth?: number
}

function formatWindowOption(
  window: TimeWindow,
  timeRangeMinutes: number | undefined,
  containerWidth: number | undefined,
): string {
  if (!timeRangeMinutes) return window.label

  const count = Math.ceil(timeRangeMinutes / window.minutes)
  const pxPerWindow = containerWidth ? Math.round(containerWidth / count) : undefined

  if (pxPerWindow !== undefined) {
    return `${window.label} (${count} × ${pxPerWindow}px)`
  }
  return `${window.label} (${count})`
}

export function AggregationControl({
  selectedWindow,
  validWindows,
  onWindowChange,
  isAutoMode,
  timeRangeMinutes,
  containerWidth,
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
          <option value="auto">
            Auto: {formatWindowOption(selectedWindow, timeRangeMinutes, containerWidth)}
          </option>
          {validWindows.map(w => (
            <option key={w.label} value={w.label}>
              {formatWindowOption(w, timeRangeMinutes, containerWidth)}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
