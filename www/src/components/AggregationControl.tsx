import { Tooltip } from './Tooltip'
import { getTargetPoints } from '../hooks/useDataAggregation'
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
  const targetPoints = getTargetPoints(containerWidth)

  return (
    <div className="control-group aggregation-section">
      <div className="header">
        <Tooltip content="Raw data arrives ≈1/min. Points are grouped into time windows for visualization. Smaller windows show more detail but may slow rendering.">
          <label className="unselectable">Aggregation:</label>
        </Tooltip>
      </div>
      <div className="body">
        <select
          value={selectedWindow.label}
          onChange={(e) => {
            const window = validWindows.find(w => w.label === e.target.value)
            if (window) onWindowChange(window)
          }}
        >
          {validWindows.map(w => (
            <option key={w.label} value={w.label}>
              {formatWindowOption(w, timeRangeMinutes, containerWidth)}
            </option>
          ))}
        </select>
      </div>
      <div className="footer">
        <Tooltip content={`Auto mode selects the smallest window that keeps data points around ${targetPoints} (targeting ≈4px per point).`}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isAutoMode}
              onChange={(e) => {
                if (e.target.checked) {
                  onWindowChange(null)
                } else {
                  onWindowChange(selectedWindow)
                }
              }}
            />
            <span>Auto</span>
          </label>
        </Tooltip>
      </div>
    </div>
  )
}
