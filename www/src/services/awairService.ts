import { parquetRead } from 'hyparquet'
import { HyparquetSource } from './dataSources/hyparquetSource'
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
// Note: hyparquet returns BigInt for integer columns, so we use bigint here
// devices.parquet: name, deviceId, deviceType, deviceUUID, lat, lon, preference, locationName, roomType, spaceType, macAddress, timezone, lastUpdated, active, dataPath
type DeviceRow = [string, bigint, string, string, bigint, bigint, string, string, string, string, string, string, string, boolean, string]

// Singleton instance for cached data fetching
const hyparquetSource = new HyparquetSource()

/**
 * S3 root for all data storage.
 * Structure:
 *   {S3_ROOT}/devices.parquet      - Device registry
 *   {S3_ROOT}/awair-{id}.parquet   - Device data files
 */
const S3_ROOT = 'https://380nwk.s3.amazonaws.com'

export function getDevicesUrl(): string {
  return `${S3_ROOT}/devices.parquet`
}

export function getDataUrl(deviceId: number): string {
  return `${S3_ROOT}/awair-${deviceId}.parquet`
}

export async function fetchDevices(): Promise<Device[]> {
  try {
    const url = getDevicesUrl()
    console.log('🔄 Fetching devices list from S3...')
    const response = await fetch(url)
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

export function getFileBounds(deviceId: number): { earliest: Date; latest: Date } | null {
  const url = getDataUrl(deviceId)
  const cache = hyparquetSource.getCache(url)
  if (!cache) return null

  const rgInfos = cache.getRowGroupInfos()
  if (rgInfos.length === 0) return null

  const earliest = rgInfos.reduce((min, rg) =>
    rg.minTimestamp && (!min || rg.minTimestamp < min) ? rg.minTimestamp : min,
    null as Date | null
  )
  const latest = rgInfos.reduce((max, rg) =>
    rg.maxTimestamp && (!max || rg.maxTimestamp > max) ? rg.maxTimestamp : max,
    null as Date | null
  )

  if (!earliest || !latest) return null
  return { earliest, latest }
}

export async function fetchAwairData(
  deviceId: number | undefined,
  timeRange: { timestamp: Date | null; duration: number }
): Promise<{ records: AwairRecord[]; summary: DataSummary; lastModified?: Date }> {
  // If no device ID provided, use first available device
  if (!deviceId) {
    const devices = await fetchDevices()
    if (devices.length === 0) {
      throw new Error('No devices found')
    }
    deviceId = devices[0].deviceId
  }

  // Calculate time range
  const to = timeRange.timestamp || new Date()
  const from = new Date(to.getTime() - timeRange.duration)

  // Use HyparquetSource with caching
  const result = await hyparquetSource.fetch({
    deviceId,
    range: { from, to },
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
      const month = String(date.getMonth() + 1)
      const day = String(date.getDate())
      const year = String(date.getFullYear()).slice(-2)
      return `${month}/${day}/${year}`
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

/**
 * Refresh cache for a device (check for new data).
 * Returns true if new data was available.
 */
export async function refreshDeviceData(deviceId: number): Promise<boolean> {
  return hyparquetSource.refresh(deviceId)
}
