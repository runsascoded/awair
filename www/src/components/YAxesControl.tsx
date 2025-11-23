import React from 'react'
import { metricConfig } from './ChartControls'
import { Tooltip } from './Tooltip'
import type { MetricsState } from "../hooks/useMetrics.ts"

interface YAxesControlProps {
  metrics: MetricsState
  yAxisFromZero: boolean
  setYAxisFromZero: (value: boolean) => void
  isMobile: boolean
}

export function YAxesControl({
  metrics: { l, r },
  yAxisFromZero,
  setYAxisFromZero,
  isMobile
}: YAxesControlProps) {
  return (
    <div className="control-group yaxes-group">
      <div className="yaxes-header">
        <label className="unselectable">Y-axes:</label>
        {isMobile ? (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={yAxisFromZero}
              onChange={(e) => setYAxisFromZero(e.target.checked)}
            />
            <span>≥0</span>
          </label>
        ) : (
          <Tooltip content="Start Y-axes from zero (Keyboard: z)">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={yAxisFromZero}
                onChange={(e) => setYAxisFromZero(e.target.checked)}
              />
              <span>≥0</span>
            </label>
          </Tooltip>
        )}
      </div>
      <div className="yaxes-controls">
        <div className="metric-select">
          {isMobile ? (
            <label className="unselectable metric-side-label">L:</label>
          ) : (
            <Tooltip content="Left Y-axis metric (Keyboard: t=Temp, c=CO₂, h=Humid, p=PM2.5, v=VOC)">
              <label className="unselectable metric-side-label">L:</label>
            </Tooltip>
          )}
          <select value={l.val} onChange={(e) => l.set(e.target.value as any)}>
            {Object.entries(metricConfig).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.emoji} {cfg.shortLabel}</option>
            ))}
          </select>
        </div>

        <div className="metric-select">
          {isMobile ? (
            <label className="unselectable metric-side-label">R:</label>
          ) : (
            <Tooltip content="Right Y-axis metric (Keyboard: Shift+T, Shift+C, Shift+H, Shift+P, Shift+V, Shift+N=None)">
              <label className="unselectable metric-side-label">R:</label>
            </Tooltip>
          )}
          <select value={r.val} onChange={(e) => r.set(e.target.value as any)}>
            <option value="none">None</option>
            {Object.entries(metricConfig).map(([key, cfg]) => (
              key !== l.val ? <option key={key} value={key}>{cfg.emoji} {cfg.shortLabel}</option> : null
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
