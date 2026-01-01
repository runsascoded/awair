import { useRef, useEffect, useState, useCallback } from 'react'
import { Tooltip } from './Tooltip'
import { MAX_SELECTED_DEVICES } from '../utils/colorUtils'
import type { Device } from '../services/awairService'
import type { DeviceRenderStrategy, HsvConfig } from '../utils/deviceRenderStrategy'

// Check if device supports hover (not a touch-only device)
const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

interface DevicesControlProps {
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
  onPreviewDeviceIds?: (deviceIds: number[] | null) => void  // null = no preview
  onHoverDeviceId?: (deviceId: number | null) => void  // For triggering data fetch
  deviceRenderStrategy: DeviceRenderStrategy
  setDeviceRenderStrategy: (value: DeviceRenderStrategy) => void
  hsvConfig: HsvConfig
  setHsvConfig: (value: HsvConfig) => void
}

export function DevicesControl({
  devices,
  selectedDeviceIds,
  onDeviceSelectionChange,
  onPreviewDeviceIds,
  onHoverDeviceId,
  deviceRenderStrategy,
  setDeviceRenderStrategy,
  hsvConfig,
  setHsvConfig
}: DevicesControlProps) {
  const isMultiDevice = selectedDeviceIds.length > 1
  const detailsRef = useRef<HTMLDetailsElement>(null)

  // Track which device is being hovered for preview
  const [hoveredDeviceId, setHoveredDeviceId] = useState<number | null>(null)

  // Compute preview device IDs when hovering
  const handleDeviceHover = useCallback((deviceId: number | null) => {
    if (!canHover) {
      setHoveredDeviceId(null)
      return
    }

    setHoveredDeviceId(deviceId)
    onHoverDeviceId?.(deviceId)  // Notify parent for data fetching

    if (deviceId === null) {
      onPreviewDeviceIds?.(null)
      return
    }

    const isCurrentlySelected = selectedDeviceIds.includes(deviceId)

    if (isCurrentlySelected) {
      // Previewing removing this device (if it's not the last one)
      if (selectedDeviceIds.length > 1) {
        onPreviewDeviceIds?.(selectedDeviceIds.filter(id => id !== deviceId))
      } else {
        // Can't uncheck the last device, no preview
        onPreviewDeviceIds?.(null)
      }
    } else {
      // Previewing adding this device (if under limit)
      if (selectedDeviceIds.length < MAX_SELECTED_DEVICES) {
        onPreviewDeviceIds?.([...selectedDeviceIds, deviceId])
      } else {
        // At max, no preview
        onPreviewDeviceIds?.(null)
      }
    }
  }, [selectedDeviceIds, onPreviewDeviceIds, onHoverDeviceId])

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

  const tooltipContent = <div>
    <p>Select devices to display on the chart (at least one device must be selected).</p>
    {isMultiDevice ? <p>🎨: Configure how devices are visually distinguished (HSL color shifts, dashed lines, or none).</p> : null}
  </div>

  return (
    <div className="control-group devices-section no-footer">
      <div className="header devices-header">
        <label className="unselectable">Devices:</label>
        <Tooltip content={tooltipContent}>
          <span className="info-icon">?</span>
        </Tooltip>
        {isMultiDevice && (
          <details
            ref={detailsRef}
            className="render-settings-details"
          >
            <summary>
              <span className="settings-icon">🎨</span>
            </summary>
            <div className="render-settings-panel">
              <div className="setting-row">
                <label>Strategy:</label>
                <Tooltip content="How to visually distinguish different devices">
                  <select
                    value={deviceRenderStrategy}
                    onChange={(e) => setDeviceRenderStrategy(e.target.value as DeviceRenderStrategy)}
                  >
                    <option value="hsv-nudge">HSL Nudge</option>
                    <option value="dash">Dashed</option>
                    <option value="none">None</option>
                  </select>
                </Tooltip>
                <Tooltip content={
                  deviceRenderStrategy === 'hsv-nudge'
                    ? "Shift hue, saturation, and lightness for each device"
                    : deviceRenderStrategy === 'dash'
                      ? "Use dashed lines for secondary devices"
                      : "No visual distinction between devices"
                }>
                  <span className="info-icon">?</span>
                </Tooltip>
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
        )}
      </div>

      <div className="body device-checkboxes">
        {devices.map((device) => {
          const isChecked = selectedDeviceIds.includes(device.deviceId)
          const isDisabled = !isChecked && selectedDeviceIds.length >= MAX_SELECTED_DEVICES
          const isHovered = hoveredDeviceId === device.deviceId
          const isLastChecked = isChecked && selectedDeviceIds.length === 1

          // Show preview styling: if hovering this device and it would change the selection
          const showPreview = isHovered && !isDisabled && !isLastChecked

          return (
            <label
              key={device.deviceId}
              className={`device ${isChecked ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} ${showPreview ? 'preview' : ''}`}
              onMouseEnter={() => handleDeviceHover(device.deviceId)}
              onMouseLeave={() => handleDeviceHover(null)}
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
              <span className="name">{device.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
