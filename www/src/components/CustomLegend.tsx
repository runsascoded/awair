import { useState, useCallback } from 'react'
import { metricConfig, getRangeFloor } from './ChartControls'
import { HoverableToggleButton } from './HoverableToggleButton'
import { Tooltip } from './Tooltip'
import type { LegendHoverState } from './AwairChart'
import type { MetricsState } from "../hooks/useMetrics"
import type { Metric, RangeFloors } from "../lib/urlParams"

// Check if device supports hover (not a touch-only device)
const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

interface CustomLegendProps {
  metrics: MetricsState
  isMobile: boolean
  deviceNames: string[]
  primaryColors: string[]
  secondaryColors: string[]
  onHover: (state: LegendHoverState) => void
  onLeftAutoRangeDisplayChange: (display: boolean) => void
  onRightAutoRangeDisplayChange: (display: boolean) => void
  getEffectiveFloor: (metric: Metric) => number
  rangeFloors: RangeFloors
  setRangeFloors: (floors: RangeFloors) => void
}

/**
 * Colored line sample with hover effect to highlight trace
 */
function LegendLineSample({
  color,
  metric,
  deviceIdx,
  onHover
}: {
  color: string
  metric: 'primary' | 'secondary'
  deviceIdx?: number  // undefined = highlight all devices for this metric
  onHover: (state: LegendHoverState) => void
}) {
  const hoverState: LegendHoverState = deviceIdx !== undefined
    ? { type: 'trace', deviceIdx: deviceIdx, metric }
    : { type: 'metric', metric }
  return (
    <span
      className="legend-line-sample"
      style={{ backgroundColor: color }}
      onMouseEnter={() => onHover(hoverState)}
    />
  )
}

/**
 * Helper to render a legend device item with hover handlers
 */
function LegendDeviceItem({
  name,
  idx,
  color,
  metric,
  onHover
}: {
  name: string
  idx: number
  color: string
  metric: 'primary' | 'secondary'
  onHover: (state: LegendHoverState) => void
}) {
  return (
    <span
      key={`${name}-${metric}`}
      className="legend-device-item"
    >
      <LegendLineSample
        color={color}
        metric={metric}
        deviceIdx={idx}
        onHover={onHover}
      />
      <span
        className="legend-device-name"
        onMouseEnter={() => onHover({ type: 'device', deviceIdx: idx })}
      >
        {name}
      </span>
    </span>
  )
}

/**
 * Custom legend metric controls positioned above Plotly's built-in legend.
 * Replaces the annotation labels with interactive dropdowns + auto-range icon buttons.
 */
export function CustomLegend({
  metrics: { l, r },
  isMobile,
  deviceNames,
  primaryColors,
  secondaryColors,
  onHover,
  onLeftAutoRangeDisplayChange,
  onRightAutoRangeDisplayChange,
  getEffectiveFloor,
  rangeFloors,
  setRangeFloors,
}: CustomLegendProps) {
  const hasSecondary = r.val !== 'none'

  // Floor editing state
  const [editingFloor, setEditingFloor] = useState<'left' | 'right' | null>(null)
  const [editValue, setEditValue] = useState('')

  // Start editing a floor value
  const startEditingFloor = useCallback((axis: 'left' | 'right') => {
    const metric = axis === 'left' ? l.val : r.val
    if (metric === 'none') return
    setEditingFloor(axis)
    setEditValue(getEffectiveFloor(metric as Metric).toString())
  }, [l.val, r.val, getEffectiveFloor])

  // Save the edited floor value
  const saveFloor = useCallback(() => {
    if (!editingFloor) return
    const metric = editingFloor === 'left' ? l.val : r.val
    if (metric === 'none') return

    const newValue = parseInt(editValue, 10)
    if (isNaN(newValue)) {
      setEditingFloor(null)
      return
    }

    // If same as default, remove from custom floors
    const defaultFloor = getRangeFloor(metric as Metric)
    if (newValue === defaultFloor) {
      const { [metric]: _, ...rest } = rangeFloors
      setRangeFloors(rest)
    } else {
      setRangeFloors({ ...rangeFloors, [metric]: newValue })
    }
    setEditingFloor(null)
  }, [editingFloor, l.val, r.val, editValue, rangeFloors, setRangeFloors])

  // Cancel editing
  const cancelEditingFloor = useCallback(() => {
    setEditingFloor(null)
  }, [])

  const isSingleDevice = deviceNames.length <= 1

  return (
    <div
      className={`custom-legend-controls${isSingleDevice ? ' single-device' : ''}`}
      onMouseOver={(e) => {
        // Reset to all traces when mouse is directly over container (not a child)
        if (e.currentTarget === e.target) onHover(null)
      }}
      onMouseLeave={() => onHover(null)}
    >
      {/* Primary metric control (left) */}
      <div
        className="legend-metric-control legend-metric-left"
        onMouseOver={(e) => { if (e.currentTarget === e.target) onHover(null) }}
      >
        <div className="legend-controls-row">
          {isMobile ? (
            <>
              <select
                value={l.val}
                onChange={(e) => l.set(e.target.value as Metric)}
                onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'primary' }) : undefined}
              >
                {Object.entries(metricConfig).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.emoji} {cfg.shortLabel}
                  </option>
                ))}
              </select>
              {editingFloor === 'left' ? (
                <input
                  type="number"
                  className="floor-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveFloor}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveFloor()
                    if (e.key === 'Escape') cancelEditingFloor()
                  }}
                  autoFocus
                />
              ) : (
                <HoverableToggleButton
                  value={!l.autoRange}
                  onChange={(active) => l.setAutoRange(!active)}
                  onDisplayChange={(display) => onLeftAutoRangeDisplayChange(!display)}
                  onDoubleClick={() => startEditingFloor('left')}
                  className="range-mode-btn"
                  title={l.autoRange ? `Click to set floor ≥${getEffectiveFloor(l.val)}; double-click to edit` : `Floor: ${getEffectiveFloor(l.val)} (double-click to edit)`}
                >
                  ≥{getEffectiveFloor(l.val)}
                </HoverableToggleButton>
              )}
            </>
          ) : (
            <>
              <Tooltip content="Left Y-axis metric (Keyboard: t=Temp, c=CO₂, h=Humid, p=PM2.5, v=VOC)">
                <select
                  value={l.val}
                  onChange={(e) => l.set(e.target.value as Metric)}
                  onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'primary' }) : undefined}
                >
                  {Object.entries(metricConfig).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.emoji} {cfg.shortLabel}
                    </option>
                  ))}
                </select>
              </Tooltip>
              {editingFloor === 'left' ? (
                <input
                  type="number"
                  className="floor-edit-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={saveFloor}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveFloor()
                    if (e.key === 'Escape') cancelEditingFloor()
                  }}
                  autoFocus
                />
              ) : (
                <Tooltip content={l.autoRange ? `Auto-range (a to toggle); double-click to set floor` : `Floor ≥${getEffectiveFloor(l.val)} (a to toggle); double-click to edit`}>
                  <HoverableToggleButton
                    value={!l.autoRange}
                    onChange={(active) => l.setAutoRange(!active)}
                    onDisplayChange={(display) => onLeftAutoRangeDisplayChange(!display)}
                    onDoubleClick={() => startEditingFloor('left')}
                    className="range-mode-btn"
                  >
                    ≥{getEffectiveFloor(l.val)}
                  </HoverableToggleButton>
                </Tooltip>
              )}
            </>
          )}
        </div>
        {/* Labels row: unit + line samples (with device names when multi-device) */}
        <div className="legend-labels-row">
          <span
            className="metric-unit left-unit"
            onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'primary' }) : undefined}
          >
            ({metricConfig[l.val].unit})
          </span>
          {deviceNames.length === 1 ? (
            <LegendLineSample color={primaryColors[0]} metric="primary" onHover={onHover} />
          ) : deviceNames.length > 1 ? (
            <div className="legend-devices">
              {deviceNames.map((name, idx) => (
                <LegendDeviceItem
                  key={`${name}-primary`}
                  name={name}
                  idx={idx}
                  color={primaryColors[idx]}
                  metric="primary"
                  onHover={onHover}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Secondary metric control (right) */}
      {hasSecondary && (
        <div
          className="legend-metric-control legend-metric-right"
          onMouseOver={(e) => { if (e.currentTarget === e.target) onHover(null) }}
        >
          <div className="legend-controls-row">
            {isMobile ? (
              <>
                {editingFloor === 'right' ? (
                  <input
                    type="number"
                    className="floor-edit-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={saveFloor}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveFloor()
                      if (e.key === 'Escape') cancelEditingFloor()
                    }}
                    autoFocus
                  />
                ) : (
                  <HoverableToggleButton
                    value={!r.autoRange}
                    onChange={(active) => r.setAutoRange(!active)}
                    onDisplayChange={(display) => onRightAutoRangeDisplayChange(!display)}
                    onDoubleClick={() => startEditingFloor('right')}
                    className="range-mode-btn"
                    title={r.autoRange ? `Click to set floor ≥${getEffectiveFloor(r.val as Metric)}; double-click to edit` : `Floor: ${getEffectiveFloor(r.val as Metric)} (double-click to edit)`}
                  >
                    ≥{getEffectiveFloor(r.val as Metric)}
                  </HoverableToggleButton>
                )}
                <select
                  value={r.val}
                  onChange={(e) => r.set(e.target.value as Metric | 'none')}
                  onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'secondary' }) : undefined}
                >
                  <option value="none">None</option>
                  {Object.entries(metricConfig).map(([key, cfg]) => (
                    key !== l.val ? (
                      <option key={key} value={key}>
                        {cfg.emoji} {cfg.shortLabel}
                      </option>
                    ) : null
                  ))}
                </select>
              </>
            ) : (
              <>
                {editingFloor === 'right' ? (
                  <input
                    type="number"
                    className="floor-edit-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={saveFloor}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveFloor()
                      if (e.key === 'Escape') cancelEditingFloor()
                    }}
                    autoFocus
                  />
                ) : (
                  <Tooltip content={r.autoRange ? `Auto-range (Shift+A to toggle); double-click to set floor` : `Floor ≥${getEffectiveFloor(r.val as Metric)} (Shift+A to toggle); double-click to edit`}>
                    <HoverableToggleButton
                      value={!r.autoRange}
                      onChange={(active) => r.setAutoRange(!active)}
                      onDisplayChange={(display) => onRightAutoRangeDisplayChange(!display)}
                      onDoubleClick={() => startEditingFloor('right')}
                      className="range-mode-btn"
                    >
                      ≥{getEffectiveFloor(r.val as Metric)}
                    </HoverableToggleButton>
                  </Tooltip>
                )}
                <Tooltip content="Right Y-axis metric (Keyboard: Shift+T, Shift+C, Shift+H, Shift+P, Shift+V, Shift+N=None)">
                  <select
                    value={r.val}
                    onChange={(e) => r.set(e.target.value as Metric | 'none')}
                    onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'secondary' }) : undefined}
                  >
                    <option value="none">None</option>
                    {Object.entries(metricConfig).map(([key, cfg]) => (
                      key !== l.val ? (
                        <option key={key} value={key}>
                          {cfg.emoji} {cfg.shortLabel}
                        </option>
                      ) : null
                    ))}
                  </select>
                </Tooltip>
              </>
            )}
          </div>
          {/* Labels row: unit + line samples (with device names when multi-device) */}
          {/* Note: row-reverse in CSS, so DOM order is: unit, then line samples */}
          <div className="legend-labels-row">
            <span
              className="metric-unit right-unit"
              onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'secondary' }) : undefined}
            >
              ({metricConfig[r.val as Metric].unit})
            </span>
            {deviceNames.length === 1 ? (
              <LegendLineSample color={secondaryColors[0]} metric="secondary" onHover={onHover} />
            ) : deviceNames.length > 1 ? (
              <div className="legend-devices">
                {deviceNames.map((name, idx) => (
                  <LegendDeviceItem
                    key={`${name}-secondary`}
                    name={name}
                    idx={idx}
                    color={secondaryColors[idx]}
                    metric="secondary"
                    onHover={onHover}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
