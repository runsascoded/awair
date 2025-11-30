import React from 'react'
import { metricConfig } from './ChartControls'
import { Tooltip } from './Tooltip'
import type { LegendHoverState } from './AwairChart'
import type { MetricsState } from "../hooks/useMetrics"
import type { Metric } from "../lib/urlParams"

interface CustomLegendProps {
  metrics: MetricsState
  isMobile: boolean
  deviceNames: string[]
  primaryColors: string[]
  secondaryColors: string[]
  onHover: (state: LegendHoverState) => void
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
      onMouseEnter={() => onHover({ type: 'device', deviceIndex: idx })}
      onMouseLeave={() => onHover(null)}
    >
      <span
        className="legend-line"
        style={{ color }}
        onMouseEnter={() => onHover({ type: 'trace', deviceIndex: idx, metric })}
        onMouseLeave={(e) => {
          // Only revert to device hover if mouse is still within the legend item
          const container = (e.currentTarget as HTMLElement).parentElement
          if (container && container.contains(e.relatedTarget as Node)) {
            e.stopPropagation()
            onHover({ type: 'device', deviceIndex: idx })
          }
        }}
      >
        ━━
      </span>
      <span className="legend-device-name">
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
  onHover
}: CustomLegendProps) {
  const hasSecondary = r.val !== 'none'

  return (
    <div className="custom-legend-controls">
      {/* Primary metric control (left) */}
      <div className="legend-metric-control legend-metric-left">
        <div className="legend-controls-row">
          {isMobile ? (
            <>
              <select
                value={l.val}
                onChange={(e) => l.set(e.target.value as Metric)}
              >
                {Object.entries(metricConfig).map(([key, cfg]) => (
                  <option key={key} value={key}>
                    {cfg.shortLabel}
                  </option>
                ))}
              </select>
              <button
                className={`range-mode-btn ${!l.autoRange ? 'active' : ''}`}
                onClick={() => l.setAutoRange(!l.autoRange)}
                title={l.autoRange ? 'Click for range ≥0' : 'Range starts at 0 (click for auto-range)'}
              >
                ≥0
              </button>
            </>
          ) : (
            <>
              <Tooltip content="Left Y-axis metric (Keyboard: t=Temp, c=CO₂, h=Humid, p=PM2.5, v=VOC)">
                <select
                  value={l.val}
                  onChange={(e) => l.set(e.target.value as Metric)}
                >
                  {Object.entries(metricConfig).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.shortLabel}
                    </option>
                  ))}
                </select>
              </Tooltip>
              <Tooltip content={l.autoRange ? 'Auto-range (a to toggle)' : 'Range ≥0 (a to toggle)'}>
                <button
                  className={`range-mode-btn ${!l.autoRange ? 'active' : ''}`}
                  onClick={() => l.setAutoRange(!l.autoRange)}
                >
                  ≥0
                </button>
              </Tooltip>
            </>
          )}
        </div>
        {/* Labels row: unit + device names */}
        <div className="legend-labels-row">
          <span className="metric-unit left-unit">({metricConfig[l.val].unit})</span>
          {deviceNames.length > 0 && (
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
          )}
        </div>
      </div>

      {/* Secondary metric control (right) */}
      {hasSecondary && (
        <div className="legend-metric-control legend-metric-right">
          <div className="legend-controls-row">
            {isMobile ? (
              <>
                <button
                  className={`range-mode-btn ${!r.autoRange ? 'active' : ''}`}
                  onClick={() => r.setAutoRange(!r.autoRange)}
                  title={r.autoRange ? 'Click for range ≥0' : 'Range starts at 0 (click for auto-range)'}
                >
                  ≥0
                </button>
                <select
                  value={r.val}
                  onChange={(e) => r.set(e.target.value as Metric | 'none')}
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
                <Tooltip content={r.autoRange ? 'Auto-range (Shift+A to toggle)' : 'Range ≥0 (Shift+A to toggle)'}>
                  <button
                    className={`range-mode-btn ${!r.autoRange ? 'active' : ''}`}
                    onClick={() => r.setAutoRange(!r.autoRange)}
                  >
                    ≥0
                  </button>
                </Tooltip>
                <Tooltip content="Right Y-axis metric (Keyboard: Shift+T, Shift+C, Shift+H, Shift+P, Shift+V, Shift+N=None)">
                  <select
                    value={r.val}
                    onChange={(e) => r.set(e.target.value as Metric | 'none')}
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
          {/* Labels row: unit + device names */}
          <div className="legend-labels-row">
            <span className="metric-unit right-unit">({metricConfig[r.val as Metric].unit})</span>
            {deviceNames.length > 0 && (
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}
