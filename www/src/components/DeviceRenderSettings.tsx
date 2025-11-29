import React from 'react'
import { Tooltip } from './Tooltip'
import type { DeviceRenderStrategy } from '../utils/deviceRenderStrategy'

export interface HsvConfig {
  hueStep: number
  saturationStep: number
  lightnessStep: number
}

interface DeviceRenderSettingsProps {
  strategy: DeviceRenderStrategy
  setStrategy: (value: DeviceRenderStrategy) => void
  hsvConfig: HsvConfig
  setHsvConfig: (value: HsvConfig) => void
}

export function DeviceRenderSettings({
  strategy,
  setStrategy,
  hsvConfig,
  setHsvConfig,
}: DeviceRenderSettingsProps) {
  return (
    <details className="device-render-settings">
      <Tooltip content="Configure how multiple devices are visually distinguished: HSL color nudging, dashed lines, or no distinction">
        <summary>
          <span className="settings-icon">🎨</span>
        </summary>
      </Tooltip>
      <div className="settings-content">
        <div className="setting-row">
          <label>Strategy:</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as DeviceRenderStrategy)}
          >
            <option value="hsv-nudge">HSL Nudge</option>
            <option value="dash">Dashed</option>
            <option value="none">None</option>
          </select>
        </div>

        {strategy === 'hsv-nudge' && (
          <>
            <div className="setting-row">
              <label title="Hue rotation per device (0-360°)">Hue:</label>
              <input
                type="range"
                min="0"
                max="60"
                step="5"
                value={hsvConfig.hueStep}
                onChange={(e) => setHsvConfig({ ...hsvConfig, hueStep: Number(e.target.value) })}
              />
              <span className="setting-value">{hsvConfig.hueStep}°</span>
            </div>

            <div className="setting-row">
              <label title="Saturation adjustment per device (0-100%)">Saturation:</label>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={hsvConfig.saturationStep}
                onChange={(e) => setHsvConfig({ ...hsvConfig, saturationStep: Number(e.target.value) })}
              />
              <span className="setting-value">{hsvConfig.saturationStep}%</span>
            </div>

            <div className="setting-row">
              <label title="Lightness adjustment per device (0-100%)">Lightness:</label>
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={hsvConfig.lightnessStep}
                onChange={(e) => setHsvConfig({ ...hsvConfig, lightnessStep: Number(e.target.value) })}
              />
              <span className="setting-value">{hsvConfig.lightnessStep}%</span>
            </div>
          </>
        )}
      </div>
    </details>
  )
}
