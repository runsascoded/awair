import React from 'react'
import { Tooltip } from './Tooltip'
import { metricConfig } from './ChartControls'

interface YAxesControlProps {
  metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'
  secondaryMetric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none'
  setMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc') => void
  setSecondaryMetric: (metric: 'temp' | 'co2' | 'humid' | 'pm25' | 'voc' | 'none') => void
  yAxisFromZero: boolean
  setYAxisFromZero: (value: boolean) => void
  isMobile: boolean
}

export function YAxesControl({
  metric,
  secondaryMetric,
  setMetric,
  setSecondaryMetric,
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
          <select value={metric} onChange={(e) => setMetric(e.target.value as any)}>
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
          <select value={secondaryMetric} onChange={(e) => setSecondaryMetric(e.target.value as any)}>
            <option value="none">None</option>
            {Object.entries(metricConfig).map(([key, cfg]) => (
              key !== metric ? <option key={key} value={key}>{cfg.emoji} {cfg.shortLabel}</option> : null
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
