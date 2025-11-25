/**
 * Multi-device rendering strategies for distinguishing between devices on charts.
 *
 * Each strategy returns Plotly line props that can be spread into trace definitions.
 */

/**
 * Plotly line properties that can be applied to traces
 */
export interface LineProps {
  color: string
  width: number
  dash?: 'solid' | 'dash' | 'dot' | 'dashdot'
}

/**
 * Strategy for rendering multiple devices with visual distinction
 */
export type DeviceRenderStrategy = 'hsv-nudge' | 'dash' | 'none'

/**
 * Configuration for HSV nudging strategy
 */
interface HsvNudgeConfig {
  hueStep: number
  saturationStep: number
  lightnessStep: number
}

/**
 * Default HSV nudge configuration
 * Only adjusts lightness, keeps hue/saturation constant
 */
const DEFAULT_HSV_CONFIG: HsvNudgeConfig = {
  hueStep: 0,
  saturationStep: 0,
  lightnessStep: 15,
}

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
 * HSV nudging strategy: Adjusts hue, saturation, or lightness
 * Uses symmetric offsetting from base color:
 * - 1 device: no offset (base color)
 * - 2 devices: one positive offset, one negative offset
 * - 3 devices: positive, base (0), negative
 */
function getHsvNudgedColor(
  baseColor: string,
  deviceIndex: number,
  totalDevices: number,
  config: HsvNudgeConfig = DEFAULT_HSV_CONFIG
): string {
  if (totalDevices === 1) {
    return baseColor
  }

  const { h, s, l } = hexToHsl(baseColor)

  // Calculate offset based on device position
  let multiplier = 0
  if (totalDevices === 2) {
    multiplier = deviceIndex === 0 ? 1 : -1
  } else if (totalDevices === 3) {
    multiplier = deviceIndex === 0 ? 1 : deviceIndex === 1 ? 0 : -1
  } else {
    // Fallback for more devices
    const middleIndex = (totalDevices - 1) / 2
    multiplier = middleIndex - deviceIndex
  }

  // Apply offsets
  const newH = (h + multiplier * config.hueStep + 360) % 360
  const newS = Math.max(0, Math.min(100, s + multiplier * config.saturationStep))
  const newL = Math.max(10, Math.min(90, l + multiplier * config.lightnessStep))

  return hslToHex(newH, newS, newL)
}

/**
 * Get line properties for a device based on rendering strategy
 *
 * @param baseColor - Base metric color (e.g., "#ff6384" for temp)
 * @param deviceIndex - Index of device (0-based)
 * @param totalDevices - Total number of devices being rendered
 * @param strategy - Rendering strategy to use
 * @param width - Base line width
 * @param hsvConfig - Optional HSV nudge configuration
 * @returns Plotly line properties
 */
export function getDeviceLineProps(
  baseColor: string,
  deviceIndex: number,
  totalDevices: number,
  strategy: DeviceRenderStrategy,
  width: number,
  hsvConfig?: HsvNudgeConfig
): LineProps {
  switch (strategy) {
    case 'hsv-nudge':
      return {
        color: getHsvNudgedColor(baseColor, deviceIndex, totalDevices, hsvConfig),
        width,
        dash: 'solid',
      }

    case 'dash':
      // Keep same color, vary dash pattern
      return {
        color: baseColor,
        width,
        dash: deviceIndex === 0 ? 'solid' : 'dash',
      }

    case 'none':
      // No distinction (useful for single device or debugging)
      return {
        color: baseColor,
        width,
        dash: 'solid',
      }

    default:
      return {
        color: baseColor,
        width,
        dash: 'solid',
      }
  }
}

/**
 * Legacy compatibility: Get device color using HSV lightness nudging
 * This maintains backwards compatibility with existing code.
 *
 * @deprecated Use getDeviceLineProps with strategy='hsv-nudge' instead
 */
export function getDeviceColor(
  baseColor: string,
  deviceIndex: number,
  totalDevices: number
): string {
  return getDeviceLineProps(baseColor, deviceIndex, totalDevices, 'hsv-nudge', 1).color
}

/**
 * Maximum number of devices that can be selected simultaneously.
 */
export const MAX_SELECTED_DEVICES = 3
