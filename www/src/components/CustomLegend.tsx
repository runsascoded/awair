import { metricConfig, getRangeFloor } from './ChartControls'
import { HoverableToggleButton } from './HoverableToggleButton'
import { Tooltip } from './Tooltip'
import type { LegendHoverState } from './AwairChart'
import type { MetricsState } from "../hooks/useMetrics"
import type { Metric } from "../lib/urlParams"

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
  onRightAutoRangeDisplayChange
}: CustomLegendProps) {
  const hasSecondary = r.val !== 'none'

  return (
    <div
      className="custom-legend-controls"
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
                    {cfg.shortLabel}
                  </option>
                ))}
              </select>
              <HoverableToggleButton
                value={!l.autoRange}
                onChange={(active) => l.setAutoRange(!active)}
                onDisplayChange={(display) => onLeftAutoRangeDisplayChange(!display)}
                className="range-mode-btn"
                title={l.autoRange ? `Click for range ≥${getRangeFloor(l.val)}` : `Range starts at ${getRangeFloor(l.val)} (click for auto-range)`}
              >
                ≥{getRangeFloor(l.val)}
              </HoverableToggleButton>
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
                      {cfg.shortLabel}
                    </option>
                  ))}
                </select>
              </Tooltip>
              <Tooltip content={l.autoRange ? 'Auto-range (a to toggle)' : `Range ≥${getRangeFloor(l.val)} (a to toggle)`}>
                <HoverableToggleButton
                  value={!l.autoRange}
                  onChange={(active) => l.setAutoRange(!active)}
                  onDisplayChange={(display) => onLeftAutoRangeDisplayChange(!display)}
                  className="range-mode-btn"
                >
                  ≥{getRangeFloor(l.val)}
                </HoverableToggleButton>
              </Tooltip>
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
                <HoverableToggleButton
                  value={!r.autoRange}
                  onChange={(active) => r.setAutoRange(!active)}
                  onDisplayChange={(display) => onRightAutoRangeDisplayChange(!display)}
                  className="range-mode-btn"
                  title={r.autoRange ? `Click for range ≥${getRangeFloor(r.val as Metric)}` : `Range starts at ${getRangeFloor(r.val as Metric)} (click for auto-range)`}
                >
                  ≥{getRangeFloor(r.val as Metric)}
                </HoverableToggleButton>
                <select
                  value={r.val}
                  onChange={(e) => r.set(e.target.value as Metric | 'none')}
                  onMouseEnter={canHover ? () => onHover({ type: 'metric', metric: 'secondary' }) : undefined}
                >
                  <option value="none">None</option>
                  {Object.entries(metricConfig).map(([key, cfg]) => (
                    key !== l.val ? (
                      <option key={key} value={key}>
                        {cfg.shortLabel}
                      </option>
                    ) : null
                  ))}
                </select>
              </>
            ) : (
              <>
                <Tooltip content={r.autoRange ? 'Auto-range (Shift+A to toggle)' : `Range ≥${getRangeFloor(r.val as Metric)} (Shift+A to toggle)`}>
                  <HoverableToggleButton
                    value={!r.autoRange}
                    onChange={(active) => r.setAutoRange(!active)}
                    onDisplayChange={(display) => onRightAutoRangeDisplayChange(!display)}
                    className="range-mode-btn"
                  >
                    ≥{getRangeFloor(r.val as Metric)}
                  </HoverableToggleButton>
                </Tooltip>
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
                          {cfg.shortLabel}
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
