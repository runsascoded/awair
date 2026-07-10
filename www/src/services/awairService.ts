import { PyrmtsSource } from './dataSources/pyrmtsSource'
import { splitDate } from "../utils/dateFormat"
import type { AwairRecord, DataSummary } from '../types/awair'

export interface Device {
  name: string
  deviceId: number
  deviceType: string
  active?: boolean
  // Milliseconds since epoch — first-of-month UTC of the device's
  // earliest raw shard. Emitted by `cfw/serve /devices` (Phase 1b).
  genesisTs?: number
}

/** `cfw/serve` origin. Serves `/q` (pyrmts pyramid queries), `/devices` (D1
 *  devices table), and `/health` (full HealthSnapshot). */
export const PYRMTS_ORIGIN = 'https://awair-serve.ryan-0dc.workers.dev'

const pyrmtsSource = new PyrmtsSource()

interface DeviceResponse {
  deviceId: number
  name: string
  deviceType: string
  genesisTs: number
  active: boolean
}

export async function fetchDevices(): Promise<Device[]> {
  const url = `${PYRMTS_ORIGIN}/devices`
  console.log('🔄 Fetching devices list from /devices…')
  try {
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) {
      throw new Error(`Failed to fetch devices: ${response.status}`)
    }
    const rows = (await response.json()) as DeviceResponse[]
    const devices: Device[] = rows
      .map(r => ({
        name: r.name,
        deviceId: r.deviceId,
        deviceType: r.deviceType,
        genesisTs: r.genesisTs,
        active: r.active,
      }))
      .filter(d => d.active !== false)
      .sort((a, b) => a.deviceId - b.deviceId)
    console.log(`📋 Loaded ${devices.length} active devices`)
    return devices
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch devices: ${message}`)
  }
}

export async function fetchAwairData(
  deviceId: number | undefined,
  timeRange: { timestamp: Date | null; duration: number },
  binBudget?: number,
  smoothing?: number | string,
): Promise<{ records: AwairRecord[]; summary: DataSummary; lastModified?: Date }> {
  if (!deviceId) {
    const devices = await fetchDevices()
    if (devices.length === 0) {
      throw new Error('No devices found')
    }
    deviceId = devices[0].deviceId
  }

  // Server (pyrmts) handles the smoothing edge-buffer fetch itself, so no
  // need to extend `from` here anymore.
  const to = timeRange.timestamp || new Date()
  const from = new Date(to.getTime() - timeRange.duration)

  const result = await pyrmtsSource.fetch({
    deviceId,
    range: { from, to },
    binBudget,
    smoothing,
  })

  let fileEarliest: string | null = null
  let fileLatest: string | null = null

  // Compute date range from records
  if (result.records.length > 0) {
    const sorted = [...result.records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    fileEarliest = new Date(sorted[0].timestamp).toISOString()
    fileLatest = new Date(sorted[sorted.length - 1].timestamp).toISOString()
  }

  let dateRange = 'No data'
  if (fileEarliest && fileLatest) {
    const formatCompactDate = (date: Date) => {
      const { yy, m, d } = splitDate(date)
      return `${m}/${d}/${yy}`
    }

    const start = formatCompactDate(new Date(fileEarliest))
    const end = formatCompactDate(new Date(fileLatest))
    dateRange = start === end ? start : `${start} - ${end}`
  }

  const summary: DataSummary = {
    count: result.records.length,
    earliest: fileEarliest,
    latest: fileLatest,
    dateRange,
  }

  return { records: result.records, summary, lastModified: result.lastModified }
}
