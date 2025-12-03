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
 * Helper: Create a Param for an integer that must be one of a predefined set of values
 * @param values - Allowed values
 * @param defaultValue - Default value (must be in values array)
 * @returns Param object for use with useUrlParam
 */
export function intFromList<T extends number>(values: readonly T[], defaultValue: T): Param<T> {
  if (!values.includes(defaultValue)) {
    throw new Error(`Default value ${defaultValue} not in allowed values: ${values.join(', ')}`)
  }
  return {
    decode: (v) => {
      if (!v) return defaultValue
      const num = parseInt(v) as T
      return values.includes(num) ? num : defaultValue
    },
    encode: (v) => v === defaultValue ? undefined : v.toString()
  }
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

  // Default is first device only
  const defaultDeviceId = devices.length > 0 ? devices[0].deviceId : null

  return {
    encode: (deviceIds) => {
      if (deviceIds.length === 0) return undefined

      // Omit param when selection matches default (first device only)
      if (deviceIds.length === 1 && deviceIds[0] === defaultDeviceId) {
        return undefined
      }

      // Check if default device is included
      const includesDefault = defaultDeviceId !== null && deviceIds.includes(defaultDeviceId)

      if (includesDefault) {
        // Encode as " name1 name2..." (leading space = include default)
        // The leading space becomes + in URL, so "d=+br" means default + br
        const otherIds = deviceIds.filter(id => id !== defaultDeviceId)
        return ' ' + otherIds.map(id => idToName.get(id) || id.toString()).join(' ')
      } else {
        // Encode without leading space (just the selected devices)
        return deviceIds
          .map(id => idToName.get(id) || id.toString())
          .join(' ')
      }
    },

    decode: (encoded) => {
      if (!encoded) {
        // Default to first device
        return defaultDeviceId !== null ? [defaultDeviceId] : []
      }

      // Leading space means "include default device"
      const includeDefault = encoded.startsWith(' ')
      const patterns = encoded.trim().split(/\s+/).filter(Boolean)

      const decodedIds = patterns
        .map(pattern => findDeviceByPattern(pattern, devices))
        .filter((id): id is number => id !== null)

      if (includeDefault && defaultDeviceId !== null) {
        // Prepend default device if not already included
        if (!decodedIds.includes(defaultDeviceId)) {
          return [defaultDeviceId, ...decodedIds]
        }
      }

      return decodedIds
    },
  }
}

/**
 * Y-axes param - combines primary metric, secondary metric, and per-axis auto-range flags
 *
 * Metric codes:
 *   t = temp
 *   c = CO2
 *   h = humidity
 *   p = PM2.5
 *   v = VOC
 *
 * Format: [primary][secondary?][a?][A?]
 *   - Single char = primary only (no secondary)
 *   - Two chars = primary + secondary
 *   - Trailing 'a' = enable auto-range for left/primary axis
 *   - Trailing 'A' = enable auto-range for right/secondary axis
 *   - Default: both axes use rangemode='tozero' (>=0)
 *
 * Examples:
 *   ?y=t    → temp only, tozero (default)
 *   ?y=tc   → temp (L) + CO2 (R), both tozero (default, omitted)
 *   ?y=tca  → temp (L) auto-range + CO2 (R) tozero
 *   ?y=tcA  → temp (L) tozero + CO2 (R) auto-range
 *   ?y=tcaA → temp (L) + CO2 (R), both auto-range
 *   ?y=ta   → temp only, auto-range
 *
 * Default: temp + CO2, both tozero (omitted from URL)
 */
export type YAxesConfig = {
  l: Metric
  r: Metric | 'none'
  lAutoRange: boolean
  rAutoRange: boolean
}

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

export function yAxesParam(init: YAxesConfig = { l: 'temp', r: 'co2', lAutoRange: false, rAutoRange: false }): Param<YAxesConfig> {
  return {
    encode: (config) => {
      // Check if matches default
      if (config.l === init.l && config.r === init.r && config.lAutoRange === init.lAutoRange && config.rAutoRange === init.rAutoRange) {
        return undefined
      }

      const primaryChar = metricToChar[config.l]
      let result = primaryChar

      if (config.r !== 'none') {
        result += metricToChar[config.r]
      }

      // Append 'a' if left auto-range is enabled
      if (config.lAutoRange) {
        result += 'a'
      }

      // Append 'A' if right auto-range is enabled
      if (config.rAutoRange) {
        result += 'A'
      }

      return result
    },

    decode: (encoded) => {
      if (!encoded) return init

      // Check for trailing auto-range flags
      const hasLeftAuto = encoded.includes('a')
      const hasRightAuto = encoded.includes('A')

      // Remove auto-range flags to get metric chars
      const metricsStr = encoded.replace(/[aA]/g, '')

      const primaryChar = metricsStr[0]
      const secondaryChar = metricsStr[1]

      const primary = charToMetric[primaryChar]
      if (!primary) {
        console.warn(`Unknown metric char: ${primaryChar}`)
        return init
      }

      if (!secondaryChar) {
        return { l: primary, r: 'none', lAutoRange: hasLeftAuto, rAutoRange: hasRightAuto }
      }

      const secondary = charToMetric[secondaryChar]
      if (!secondary) {
        console.warn(`Unknown metric char: ${secondaryChar}`)
        return { l: primary, r: 'none', lAutoRange: hasLeftAuto, rAutoRange: hasRightAuto }
      }

      return { l: primary, r: secondary, lAutoRange: hasLeftAuto, rAutoRange: hasRightAuto }
    },
  }
}

/**
 * Default Y-axes param instance with temp + CO2, both using tozero (>=0) range mode
 */
export const defaultYAxesParam = yAxesParam({ l: 'temp', r: 'co2', lAutoRange: false, rAutoRange: false })

/**
 * Time range URL param - wraps codec in Param interface
 */
export type { TimeRange } from './timeRangeCodec'
export { encodeTimeRange, decodeTimeRange }

export const timeRangeParam: Param<import('./timeRangeCodec').TimeRange> = {
  encode: encodeTimeRange,
  decode: decodeTimeRange,
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
 * HSL configuration param - stores hue/saturation/lightness step values
 *
 * Compact encoding: "h{num}s{num}l{num}" where only non-zero values are included
 * Examples:
 *   ?hsl=l12     → hue=0, sat=0, lightness=12 (default)
 *   ?hsl=h10l15  → hue=10, sat=0, lightness=15
 *   ?hsl=h10s5l20 → hue=10, sat=5, lightness=20
 *
 * Default (0,0,12) is omitted from URL
 */
export const hsvConfigParam: Param<import('../utils/deviceRenderStrategy').HsvConfig> = {
  encode: (config) => {
    // Default values (lightness-only nudging)
    if (config.hueStep === 0 && config.saturationStep === 0 && config.lightnessStep === 12) {
      return undefined
    }
    const parts: string[] = []
    if (config.hueStep !== 0) parts.push(`h${config.hueStep}`)
    if (config.saturationStep !== 0) parts.push(`s${config.saturationStep}`)
    if (config.lightnessStep !== 0) parts.push(`l${config.lightnessStep}`)
    return parts.length > 0 ? parts.join('') : undefined
  },
  decode: (encoded) => {
    if (!encoded) {
      return { hueStep: 0, saturationStep: 0, lightnessStep: 12 }
    }
    // Parse format like "h10s5l15" or "l15"
    const hMatch = encoded.match(/h(\d+)/)
    const sMatch = encoded.match(/s(\d+)/)
    const lMatch = encoded.match(/l(\d+)/)

    return {
      hueStep: hMatch ? Number(hMatch[1]) : 0,
      saturationStep: sMatch ? Number(sMatch[1]) : 0,
      lightnessStep: lMatch ? Number(lMatch[1]) : 12,
    }
  },
}

/**
 * X-axis grouping param - unified param for aggregation control
 *
 * Encodes both auto mode (px values) and fixed window mode (time labels)
 *
 * Auto mode (px suffix):
 *   ?x=1px  → auto mode, 1px per point (default, omitted)
 *   ?x=2px  → auto mode, 2px per point
 *   ?x=4px  → auto mode, 4px per point
 *   ?x=8px  → auto mode, 8px per point
 *
 * Fixed window mode (time labels):
 *   ?x=5m   → fixed 5-minute windows
 *   ?x=1h   → fixed 1-hour windows
 *   ?x=1d   → fixed 1-day windows
 *
 * Default: 1px (auto mode, omitted from URL)
 */
export type XGrouping =
  | { mode: 'auto'; targetPx: number }
  | { mode: 'fixed'; windowLabel: string }

export const xGroupingParam: Param<XGrouping> = {
  encode: (value) => {
    if (value.mode === 'auto') {
      if (value.targetPx === 1) return undefined  // Default, omit from URL
      return `${value.targetPx}px`
    }
    // Fixed window mode
    return value.windowLabel
  },
  decode: (encoded) => {
    if (!encoded) return { mode: 'auto', targetPx: 1 }  // Default

    // Check for px suffix (auto mode)
    const pxMatch = encoded.match(/^(\d+)px$/)
    if (pxMatch) {
      const px = parseInt(pxMatch[1], 10)
      if ([1, 2, 4, 8].includes(px)) {
        return { mode: 'auto', targetPx: px }
      }
      return { mode: 'auto', targetPx: 1 }  // Invalid px, use default
    }

    // Otherwise treat as window label (fixed mode)
    return { mode: 'fixed', windowLabel: encoded }
  },
}

/**
 * OG mode param - for screenshot generation (hides controls, fullscreen chart)
 */
export const ogModeParam: Param<boolean> = {
  encode: (value) => value ? '' : undefined,
  decode: (encoded) => encoded !== undefined,
}

/**
 * Refetch interval param (for testing) - override default 60s polling
 *
 * Examples:
 *   ?ri=5000  → 5 second polling
 *   ?ri=1000  → 1 second polling
 *   ?ri=0     → disable polling
 */
export const refetchIntervalParam: Param<number | undefined> = {
  encode: (value) => value === 60_000 ? undefined : String(value),
  decode: (encoded) => encoded !== undefined ? parseInt(encoded, 10) : undefined,
}

/**
 * Re-export common param builders from use-url-params
 */
export { boolParam, enumParam, intParam, stringParam } from '@rdub/use-url-params'
