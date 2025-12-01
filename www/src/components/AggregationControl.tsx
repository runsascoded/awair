import { Tooltip } from './Tooltip'
import type { TimeWindow } from '../hooks/useDataAggregation'

export const PX_OPTIONS = [1, 2, 4, 8] as const
export type PxOption = typeof PX_OPTIONS[number]

interface AggregationControlProps {
  selectedWindow: TimeWindow
  validWindows: TimeWindow[]
  onWindowChange: (window: TimeWindow | null) => void
  targetPx: PxOption | null  // null = fixed window mode
  onTargetPxChange: (px: PxOption | null) => void
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
  targetPx,
  onTargetPxChange,
  timeRangeMinutes,
  containerWidth,
}: AggregationControlProps) {
  const isAutoMode = targetPx !== null

  return (
    <div className="control-group aggregation-section">
      <div className="header">
        <label className="unselectable">X grouping:</label>
        <Tooltip content="Raw data arrives ≈1/min. Points are grouped into time windows for visualization. Smaller windows show more detail but may slow rendering.">
          <span className="info-icon">?</span>
        </Tooltip>
      </div>
      <div className="body">
        <select
          value={isAutoMode ? '' : selectedWindow.label}
          onChange={(e) => {
            const window = validWindows.find(w => w.label === e.target.value)
            if (window) {
              onTargetPxChange(null)  // Disable auto mode
              onWindowChange(window)
            }
          }}
          className={`window-select ${isAutoMode ? 'auto-controlled' : ''}`}
        >
          {isAutoMode && (
            <option value="" disabled>
              {formatWindowOption(selectedWindow, timeRangeMinutes, containerWidth)}
            </option>
          )}
          {validWindows.map(w => (
            <option key={w.label} value={w.label}>
              {formatWindowOption(w, timeRangeMinutes, containerWidth)}
            </option>
          ))}
        </select>
      </div>
      <div className="footer">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={isAutoMode}
            onChange={(e) => {
              if (e.target.checked) {
                onTargetPxChange(1)  // Default to 1px
                onWindowChange(null)
              } else {
                onTargetPxChange(null)
                onWindowChange(selectedWindow)
              }
            }}
          />
          <span>Auto:</span>
        </label>
        <Tooltip content="Auto mode dynamically selects the time window to achieve the target pixels per data point.">
          <span className="info-icon">?</span>
        </Tooltip>
        <Tooltip content="Target pixels per aggregated data point. Lower values show more detail.">
          <select
            value={targetPx ?? 1}
            disabled={!isAutoMode}
            onChange={(e) => {
              onTargetPxChange(Number(e.target.value) as PxOption)
            }}
            className="px-select"
          >
            {PX_OPTIONS.map(px => (
              <option key={px} value={px}>{px}px</option>
            ))}
          </select>
        </Tooltip>
      </div>
    </div>
  )
}
