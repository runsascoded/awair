import type { TimeWindow } from '../hooks/useDataAggregation'

interface AggregationControlProps {
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  windowCount: number
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
    return `${window.label} (${count}, ${pxPerWindow}px)`
  }
  return `${window.label} (${count})`
}

export function AggregationControl({
  selectedWindow,
  validWindows,
  windowCount,
  onWindowChange,
  isAutoMode,
  timeRangeMinutes,
  containerWidth,
}: AggregationControlProps) {
  const pxPerWindow = containerWidth && windowCount > 0
    ? Math.round(containerWidth / windowCount)
    : undefined

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
            <option key={w.label} value={w.label}>
              {formatWindowOption(w, timeRangeMinutes, containerWidth)}
            </option>
          ))}
        </select>
        <span className="info-text">
          {windowCount}{pxPerWindow !== undefined && ` @ ${pxPerWindow}px`}
        </span>
      </div>
    </div>
  )
}
