import { parquetRead } from 'hyparquet'
import { HyparquetSource } from './dataSources/hyparquetSource'
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
// Note: hyparquet returns BigInt for integer columns, so we use bigint here
// devices.parquet: name, deviceId, deviceType, deviceUUID, lat, lon, preference, locationName, roomType, spaceType, macAddress, timezone, lastUpdated, active, dataPath
type DeviceRow = [string, bigint, string, string, bigint, bigint, string, string, string, string, string, string, string, boolean, string]

// Singleton instance for cached data fetching
const hyparquetSource = new HyparquetSource()

/**
 * S3 root for all data storage.
 * Structure:
 *   {S3_ROOT}/devices.parquet           - Device registry
 *   {S3_ROOT}/awair-{id}/{YYYY-MM}.parquet - Monthly device data files
 */
const S3_ROOT = 'https://380nwk.s3.amazonaws.com'

export function getDevicesUrl(): string {
  return `${S3_ROOT}/devices.parquet`
}

/**
 * Get URL for a specific monthly data file.
 * @param deviceId Device ID
 * @param yearMonth Year-month string (e.g., "2025-01")
 */
export function getMonthlyDataUrl(deviceId: number, yearMonth: string): string {
  return `${S3_ROOT}/awair-${deviceId}/${yearMonth}.parquet`
}

/**
 * Get all year-month strings that overlap a date range.
 * Returns strings like ["2024-12", "2025-01", "2025-02"].
 */
export function getMonthsInRange(from: Date, to: Date): string[] {
  const months: string[] = []
  const current = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(), to.getMonth(), 1)

  while (current <= end) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, '0')
    months.push(`${year}-${month}`)
    current.setMonth(current.getMonth() + 1)
  }

  return months
}

/**
 * Get all monthly data URLs for a device within a date range.
 */
export function getMonthlyDataUrls(deviceId: number, from: Date, to: Date): string[] {
  return getMonthsInRange(from, to).map(ym => getMonthlyDataUrl(deviceId, ym))
}

/**
 * Legacy: Get URL for single-file data (deprecated).
 * Used only for backward compatibility during migration.
 */
export function getDataUrl(deviceId: number): string {
  return `${S3_ROOT}/awair-${deviceId}.parquet`
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

export function getFileBounds(deviceId: number): { earliest: Date; latest: Date } | null {
  return hyparquetSource.getFileBounds(deviceId)
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

/**
 * Refresh cache for a device (check for new data).
 * Returns true if new data was available.
 */
export async function refreshDeviceData(deviceId: number): Promise<boolean> {
  return hyparquetSource.refresh(deviceId)
}
