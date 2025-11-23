import React from 'react'
import { MAX_SELECTED_DEVICES } from '../utils/colorUtils'
import type { Device } from '../services/awairService'

interface DevicesControlProps {
  devices: Device[]
  selectedDeviceIds: number[]
  onDeviceSelectionChange: (deviceIds: number[]) => void
}

export function DevicesControl({
  devices,
  selectedDeviceIds,
  onDeviceSelectionChange
}: DevicesControlProps) {
  if (devices.length <= 1) {
    return null
  }

  return (
    <div className="control-group devices-section">
      <label className="unselectable">Devices:</label>
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
