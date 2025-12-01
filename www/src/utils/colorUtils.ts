/**
 * Color utilities for multi-device display.
 * Generates lightness variations of base colors for distinguishing devices.
 */

/**
 * Parse hex color to HSL components
 */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) {
    return { h: 0, s: 50, l: 50 }
  }

  const r = parseInt(result[1], 16) / 255
  const g = parseInt(result[2], 16) / 255
  const b = parseInt(result[3], 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      case b:
        h = ((r - g) / d + 4) / 6
        break
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 }
}

/**
 * Convert HSL to hex color
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0, g = 0, b = 0

  if (h >= 0 && h < 60) { r = c; g = x; b = 0 }
  else if (h >= 60 && h < 120) { r = x; g = c; b = 0 }
  else if (h >= 120 && h < 180) { r = 0; g = c; b = x }
  else if (h >= 180 && h < 240) { r = 0; g = x; b = c }
  else if (h >= 240 && h < 300) { r = x; g = 0; b = c }
  else { r = c; g = 0; b = x }

  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Get lightness offset for a device index given total device count.
 * Uses symmetric nudging from base color:
 * - 1 device: no offset (base color)
 * - 2 devices: one lighter (+15%), one darker (-15%)
 * - 3 devices: lighter (+15%), base (0%), darker (-15%)
 */
function getLightnessOffset(deviceIdx: number, totalDevices: number): number {
  const LIGHTNESS_STEP = 15

  if (totalDevices === 1) {
    return 0
  }

  if (totalDevices === 2) {
    // Device 0: lighter, Device 1: darker
    return deviceIdx === 0 ? LIGHTNESS_STEP : -LIGHTNESS_STEP
  }

  if (totalDevices === 3) {
    // Device 0: lighter, Device 1: base, Device 2: darker
    if (deviceIdx === 0) return LIGHTNESS_STEP
    if (deviceIdx === 1) return 0
    return -LIGHTNESS_STEP
  }

  // Fallback for more devices (shouldn't happen with max 3)
  const middleIndex = (totalDevices - 1) / 2
  return Math.round((middleIndex - deviceIdx) * LIGHTNESS_STEP)
}

/**
 * Adjust a color's lightness for multi-device display.
 *
 * @param baseColor - Hex color string (e.g., "#ff6384")
 * @param deviceIdx - Index of the device (0-based)
 * @param totalDevices - Total number of selected devices
 * @returns Adjusted hex color
 */
export function getDeviceColor(
  baseColor: string,
  deviceIdx: number,
  totalDevices: number
): string {
  if (totalDevices <= 1) {
    return baseColor
  }

  const { h, s, l } = hexToHsl(baseColor)
  const offset = getLightnessOffset(deviceIdx, totalDevices)

  // Clamp lightness to valid range [10, 90] to ensure visibility
  const newL = Math.max(10, Math.min(90, l + offset))

  return hslToHex(h, s, newL)
}

/**
 * Maximum number of devices that can be selected simultaneously.
 */
export const MAX_SELECTED_DEVICES = 3
