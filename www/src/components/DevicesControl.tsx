import React, { useRef, useEffect } from 'react'
import { Tooltip } from './Tooltip'
import { MAX_SELECTED_DEVICES } from '../utils/colorUtils'
import type { HsvConfig } from './DeviceRenderSettings'
import type { Device } from '../services/awairService'
import type { DeviceRenderStrategy } from '../utils/deviceRenderStrategy'

interface DevicesControlProps {
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
  deviceRenderStrategy: DeviceRenderStrategy
  setDeviceRenderStrategy: (value: DeviceRenderStrategy) => void
  hsvConfig: HsvConfig
  setHsvConfig: (value: HsvConfig) => void
}

export function DevicesControl({
  devices,
  selectedDeviceIds,
  onDeviceSelectionChange,
  deviceRenderStrategy,
  setDeviceRenderStrategy,
  hsvConfig,
  setHsvConfig
}: DevicesControlProps) {
  const isMultiDevice = selectedDeviceIds.length > 1
  const detailsRef = useRef<HTMLDetailsElement>(null)

  // Close details when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (detailsRef.current && !detailsRef.current.contains(event.target as Node)) {
        detailsRef.current.open = false
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (devices.length <= 1) {
    return null
  }

  return (
    <div className="control-group devices-section">
      <div className="devices-header">
        <label className="unselectable">Devices:</label>
        <Tooltip content={isMultiDevice
          ? "Configure how multiple devices are visually distinguished: HSV color nudging, dashed lines, or no distinction"
          : "Select multiple devices to configure visual distinction (HSV color nudging, dashed lines, or no distinction)"
        }>
          <details ref={detailsRef} className={`render-settings-details ${!isMultiDevice ? 'disabled' : ''}`}>
            <summary>
              <span className="settings-icon">🎨</span>
            </summary>
            {isMultiDevice && (
              <div className="render-settings-panel">
                <div className="setting-row">
                  <label>Strategy:</label>
                  <select
                    value={deviceRenderStrategy}
                    onChange={(e) => setDeviceRenderStrategy(e.target.value as DeviceRenderStrategy)}
                  >
                    <option value="hsv-nudge">HSV Nudge</option>
                    <option value="dash">Dashed</option>
                    <option value="none">None</option>
                  </select>
                </div>

                {deviceRenderStrategy === 'hsv-nudge' && (
                  <>
                    <div className="setting-row">
                      <label title="Hue rotation per device (0-60°)">Hue:</label>
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
                        step="5"
                        value={hsvConfig.lightnessStep}
                        onChange={(e) => setHsvConfig({ ...hsvConfig, lightnessStep: Number(e.target.value) })}
                      />
                      <span className="setting-value">{hsvConfig.lightnessStep}%</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </details>
        </Tooltip>
      </div>

      <div className="device-checkboxes">
        {devices.map((device) => {
          const isChecked = selectedDeviceIds.includes(device.deviceId)
          const isDisabled = !isChecked && selectedDeviceIds.length >= MAX_SELECTED_DEVICES
          return (
            <label
              key={device.deviceId}
              className={`device-checkbox ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isDisabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    onDeviceSelectionChange([...selectedDeviceIds, device.deviceId])
                  } else {
                    // Don't allow unchecking the last device
                    if (selectedDeviceIds.length > 1) {
                      onDeviceSelectionChange(selectedDeviceIds.filter(id => id !== device.deviceId))
                    }
                  }
                }}
              />
              <span className="device-name">{device.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
