/**
 * URL parameter definitions for Awair app state
 */

import { encodeTimeRange, decodeTimeRange } from './timeRangeCodec'
import type { Device } from '../services/awairService'
import type { Param } from '@rdub/use-url-params'

/**
 * Metric type used in charts
 */
export type Metric = 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'

/**
 * Metrics configuration: primary and optional secondary
 */
export type Metrics = {
  l: Metric
  r: Metric | 'none'
}

/**
 * Find device by pattern (exact ID, or case-insensitive substring match)
 * Requires exactly one match - warns and returns null if ambiguous
 */
function findDeviceByPattern(pattern: string, devices: Device[]): number | null {
  const lower = pattern.toLowerCase()

  // Try exact numeric ID match first
  const numId = parseInt(pattern, 10)
  if (!isNaN(numId)) {
    const device = devices.find(d => d.deviceId === numId)
    if (device) return device.deviceId
  }

  // Try case-insensitive substring match on name
  const nameMatches = devices.filter(d =>
    d.name?.toLowerCase().includes(lower)
  )

  if (nameMatches.length === 1) {
    return nameMatches[0].deviceId
  } else if (nameMatches.length > 1) {
    console.warn(`Ambiguous device pattern "${pattern}" matches: ${nameMatches.map(d => d.name).join(', ')}`)
    return null
  } else {
    console.warn(`Unknown device: ${pattern}`)
    return null
  }
}

/**
 * Device IDs param - encodes as space-separated list (rendered as + in URL)
 * Uses short device names when available (gym, br) for readability
 * Falls back to IDs for unknown devices
 *
 * Decoding uses case-insensitive substring matching, requires unique match
 *
 * Examples:
 *   ?d=gym         - Single device matching "gym"
 *   ?d=gym+br      - Two devices (space-separated, + in URL)
 *   ?d=17617       - Numeric ID fallback
 */
export function deviceIdsParam(devices: Device[]): Param<number[]> {
  // Build ID -> short name mapping for encoding
  const idToName = new Map<number, string>()

  for (const device of devices) {
    if (device.name) {
      const shortName = device.name.toLowerCase().replace(/\s+/g, '')
      idToName.set(device.deviceId, shortName)
    }
  }

  return {
    encode: (deviceIds) => {
      if (deviceIds.length === 0) return undefined

      // Encode each ID as short name (if available) or numeric ID
      return deviceIds
        .map(id => idToName.get(id) || id.toString())
        .join(' ')  // Space-separated, becomes + in URL
    },

    decode: (encoded) => {
      if (!encoded) {
        // Default to first device (which is gym after sorting)
        return devices.length > 0 ? [devices[0].deviceId] : []
      }

      // Decode each space-separated pattern (+ decoded to space by URLSearchParams)
      return encoded
        .split(' ')
        .map(pattern => findDeviceByPattern(pattern, devices))
        .filter((id): id is number => id !== null)
    },
  }
}

/**
 * Metrics param - combines primary and secondary metric into compact encoding
 *
 * Single char = primary only (no secondary)
 * Two chars = primary + secondary
 *
 * Metric codes:
 *   t = temp
 *   c = CO2
 *   h = humidity
 *   p = PM2.5
 *   v = VOC
 *
 * Examples:
 *   ?m=t   → temp only
 *   ?m=tc  → temp (L) + CO2 (R)
 *   ?m=th  → temp (L) + humidity (R)
 *   ?m=p   → PM2.5 only
 *
 * Default: temp only
 */
export function metricsParam(init: Metrics = { l: 'temp', r: 'none' }): Param<Metrics> {
  const metricToChar: Record<Metric, string> = {
    temp: 't',
    co2: 'c',
    humid: 'h',
    pm25: 'p',
    voc: 'v',
  }

  const charToMetric: Record<string, Metric> = {
    t: 'temp',
    c: 'co2',
    h: 'humid',
    p: 'pm25',
    v: 'voc',
  }

  return {
    encode: (config) => {
      // Check if matches default
      if (config.l === init.l && config.r === init.r) {
        return undefined
      }

      const primaryChar = metricToChar[config.l]
      if (config.r === 'none') {
        return primaryChar
      }

      const secondaryChar = metricToChar[config.r]
      return `${primaryChar}${secondaryChar}`
    },

    decode: (encoded) => {
      if (!encoded) return init

      const primaryChar = encoded[0]
      const secondaryChar = encoded[1]

      const primary = charToMetric[primaryChar]
      if (!primary) {
        console.warn(`Unknown metric char: ${primaryChar}`)
        return init
      }

      if (!secondaryChar) {
        return { l: primary, r: 'none' }
      }

      const secondary = charToMetric[secondaryChar]
      if (!secondary) {
        console.warn(`Unknown metric char: ${secondaryChar}`)
        return { l: primary, r: 'none' }
      }

      return { l: primary, r: secondary }
    },
  }
}

/**
 * Default metrics param instance with temp + CO2 defaults
 */
export const defaultMetricsParam = metricsParam({ l: 'temp', r: 'co2' })

/**
 * Time range URL param - wraps codec in Param interface
 */
export type { TimeRange } from './timeRangeCodec'
export { encodeTimeRange, decodeTimeRange }

export const timeRangeParam: Param<import('./timeRangeCodec').TimeRange> = {
  encode: encodeTimeRange,
  decode: decodeTimeRange
}

/**
 * Device render strategy param - stores how multiple devices are visually distinguished
 *
 * Values:
 *   - hsv-nudge (default): Adjust lightness for each device
 *   - dash: Use dashed lines for secondary devices
 *   - none: No visual distinction
 *
 * URL encoding:
 *   ?dr=hsv  → hsv-nudge
 *   ?dr=dash → dash
 *   ?dr=none → none
 */
export const deviceRenderStrategyParam: Param<import('../utils/deviceRenderStrategy').DeviceRenderStrategy> = {
  encode: (strategy) => {
    if (strategy === 'hsv-nudge') return undefined // Default, omit from URL
    if (strategy === 'dash') return 'dash'
    if (strategy === 'none') return 'none'
    return undefined
  },
  decode: (encoded) => {
    if (!encoded) return 'hsv-nudge' // Default
    if (encoded === 'dash') return 'dash'
    if (encoded === 'none') return 'none'
    console.warn(`Unknown device render strategy: ${encoded}`)
    return 'hsv-nudge'
  },
}

/**
 * HSV configuration param - stores hue/saturation/lightness step values
 *
 * Compact encoding: "h,s,l" where each is a number 0-100
 * Examples:
 *   ?hsv=0,0,15  → hue=0, sat=0, lightness=15 (default)
 *   ?hsv=10,5,20 → hue=10, sat=5, lightness=20
 *
 * Default (0,0,15) is omitted from URL
 */
export const hsvConfigParam: Param<import('../components/DeviceRenderSettings').HsvConfig> = {
  encode: (config) => {
    // Default values (lightness-only nudging)
    if (config.hueStep === 0 && config.saturationStep === 0 && config.lightnessStep === 15) {
      return undefined
    }
    return `${config.hueStep},${config.saturationStep},${config.lightnessStep}`
  },
  decode: (encoded) => {
    if (!encoded) {
      return { hueStep: 0, saturationStep: 0, lightnessStep: 15 }
    }
    const parts = encoded.split(',').map(Number)
    if (parts.length !== 3 || parts.some(isNaN)) {
      console.warn(`Invalid HSV config: ${encoded}`)
      return { hueStep: 0, saturationStep: 0, lightnessStep: 15 }
    }
    return {
      hueStep: parts[0],
      saturationStep: parts[1],
      lightnessStep: parts[2],
    }
  },
}

/**
 * Aggregation window param - stores user-selected aggregation window override
 *
 * Uses label format: 1m, 5m, 1h, etc.
 * null/undefined = auto mode (algorithm selects optimal window)
 *
 * Examples:
 *   ?agg=5m  → 5-minute windows
 *   ?agg=1h  → 1-hour windows
 *   (omit)   → auto mode
 */
export const aggWindowParam: Param<string | null> = {
  encode: (label) => label || undefined,
  decode: (encoded) => encoded || null,
}

/**
 * Target pixels per point param - controls auto aggregation mode
 *
 * When set, auto mode dynamically selects the time window to achieve
 * approximately this many pixels per data point.
 *
 * Examples:
 *   ?px=1  → 1px per point (maximum detail)
 *   ?px=4  → 4px per point (default balance)
 *   (omit) → 1px default
 *
 * Valid values: 1, 2, 4, 8
 * null means fixed window mode (use aggWindowParam instead)
 */
export const targetPxParam: Param<number | null> = {
  encode: (px) => {
    if (px === null) return 'off'
    if (px === 1) return undefined  // Default, omit from URL
    return String(px)
  },
  decode: (encoded) => {
    if (encoded === 'off') return null
    if (!encoded) return 1  // Default to 1px
    const num = parseInt(encoded, 10)
    if ([1, 2, 4, 8].includes(num)) return num
    return 1
  },
}

/**
 * Re-export common param builders from use-url-params
 */
export { boolParam, enumParam, intParam, stringParam } from '@rdub/use-url-params'
