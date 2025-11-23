/**
 * URL parameter definitions for Awair app state
 */

import type { Device } from '../services/awairService'
import type { Param } from 'use-url-params'

/**
 * Device IDs param - encodes as space-separated list
 * Uses device names when available (gym, br) for readability
 * Falls back to IDs for unknown devices
 *
 * Examples:
 *   ?d=gym
 *   ?d=gym+br
 *   ?d=17617+137496
 */
export function deviceIdsParam(devices: Device[]): Param<number[]> {
  // Build name <-> ID mappings
  const nameToId = new Map<string, number>()
  const idToName = new Map<number, string>()

  for (const device of devices) {
    if (device.name) {
      const shortName = device.name.toLowerCase().replace(/\s+/g, '')
      nameToId.set(shortName, device.deviceId)
      idToName.set(device.deviceId, shortName)
    }
  }

  return {
    encode: (deviceIds) => {
      if (deviceIds.length === 0) return undefined

      // Encode each ID as name (if available) or ID
      const encoded = deviceIds
        .map(id => idToName.get(id) || id.toString())
        .join('+')

      return encoded
    },

    decode: (encoded) => {
      if (!encoded) return []

      // Decode each part as name or ID
      return encoded
        .split('+')
        .map(part => {
          // Try as name first
          const id = nameToId.get(part.toLowerCase())
          if (id !== undefined) return id

          // Try as numeric ID
          const numericId = parseInt(part, 10)
          if (!isNaN(numericId)) return numericId

          console.warn(`Unknown device: ${part}`)
          return null
        })
        .filter((id): id is number => id !== null)
    },
  }
}
