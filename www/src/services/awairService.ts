import { parquetRead } from 'hyparquet'
import { PyrmtsSource } from './dataSources/pyrmtsSource'
import { splitDate } from "../utils/dateFormat"
import type { AwairRecord, DataSummary } from '../types/awair'

export interface Device {
  name: string
  deviceId: number
  deviceType: string
  dataPath?: string
  active?: boolean
  lastUpdated?: string
}

// Parquet row tuple types (match column order in files)
// devices.parquet: name, deviceId, deviceType, deviceUUID, lat, lon, preference, locationName, roomType, spaceType, macAddress, timezone, lastUpdated, active, dataPath
type DeviceRow = [string, bigint, string, string, bigint, bigint, string, string, string, string, string, string, string, boolean, string]

const pyrmtsSource = new PyrmtsSource()

/**
 * S3 root for the devices registry. Per-device time-series data lives in R2
 * now (served via the pyrmts CFW worker); only `devices.parquet` is still
 * read from S3 directly because it's tiny and infrequently changed.
 */
const S3_ROOT = 'https://380nwk.s3.amazonaws.com'

export function getDevicesUrl(): string {
  return `${S3_ROOT}/devices.parquet`
}

export async function fetchDevices(): Promise<Device[]> {
  try {
    const url = getDevicesUrl()
    console.log('🔄 Fetching devices list from S3...')
    // Use no-cache to bypass browser HTTP cache - ensures fresh data when React Query refetches
    const response = await fetch(url, { cache: 'no-cache' })
    if (!response.ok) {
      throw new Error(`Failed to fetch devices: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()

    let rows: DeviceRow[] = []
    await parquetRead({
      file: arrayBuffer,
      onComplete: (data) => {
        if (Array.isArray(data)) {
          rows = data as DeviceRow[]
        }
      }
    })

    if (rows.length === 0) {
      throw new Error('No devices found in Parquet file')
    }

    // Convert tuple rows to typed records
    // Note: deviceId is BigInt from parquet, convert to Number for JS compatibility
    const devices: Device[] = rows.map((row) => ({
      name: row[0],
      deviceId: Number(row[1]),
      deviceType: row[2],
      // Skip deviceUUID, lat, lon, preference, locationName, roomType, spaceType, macAddress, timezone (indices 3-11)
      lastUpdated: row[12],
      active: row[13],
      dataPath: row[14],
    }))

    // Filter to active devices only
    const activeDevices = devices.filter(d => d.active !== false)

    // Sort devices by ID (ascending) - gym (17617) is lowest ID and will be first
    activeDevices.sort((a, b) => a.deviceId - b.deviceId)

    console.log(`📋 Loaded ${activeDevices.length} active devices`)
    return activeDevices
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch devices from S3: ${message}`)
  }
}

export async function fetchAwairData(
  deviceId: number | undefined,
  timeRange: { timestamp: Date | null; duration: number },
  lookbackMinutes: number = 0,
  binBudget?: number,
): Promise<{ records: AwairRecord[]; summary: DataSummary; lastModified?: Date }> {
  if (!deviceId) {
    const devices = await fetchDevices()
    if (devices.length === 0) {
      throw new Error('No devices found')
    }
    deviceId = devices[0].deviceId
  }

  // Calculate time range, extending start by lookback for rolling average edge accuracy
  const to = timeRange.timestamp || new Date()
  const lookbackMs = lookbackMinutes * 60 * 1000
  const from = new Date(to.getTime() - timeRange.duration - lookbackMs)

  const result = await pyrmtsSource.fetch({
    deviceId,
    range: { from, to },
    binBudget,
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
