/**
 * URL parameter definitions for Awair app state
 */

import type { Device } from '../services/awairService'
import type { Param } from 'use-url-params'

/**
 * Metric type used in charts
 */
export type Metric = 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'

/**
 * Metrics configuration: primary and optional secondary
 */
export type MetricsConfig = {
  primary: Metric
  secondary: Metric | 'none'
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
      if (!encoded) return []

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
export function metricsParam(init: MetricsConfig = { primary: 'temp', secondary: 'none' }): Param<MetricsConfig> {
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
      if (config.primary === init.primary && config.secondary === init.secondary) {
        return undefined
      }

      const primaryChar = metricToChar[config.primary]
      if (config.secondary === 'none') {
        return primaryChar
      }

      const secondaryChar = metricToChar[config.secondary]
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
        return { primary, secondary: 'none' }
      }

      const secondary = charToMetric[secondaryChar]
      if (!secondary) {
        console.warn(`Unknown metric char: ${secondaryChar}`)
        return { primary, secondary: 'none' }
      }

      return { primary, secondary }
    },
  }
}

/**
 * Re-export common param builders from use-url-params
 */
export { boolParam, enumParam, intParam, stringParam } from 'use-url-params'
