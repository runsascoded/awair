import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from 'hyparquet'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface Device {
  name: string
  deviceId: number
  deviceType: string
  dataPath?: string
  active?: boolean
  lastUpdated?: string
}

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

    let rows: any[] = []
    await parquetRead({
      file: arrayBuffer,
      onComplete: (data) => {
        if (Array.isArray(data)) {
          rows = data
        }
      }
    })

    if (rows.length === 0) {
      throw new Error('No devices found in Parquet file')
    }

    // Convert array format to typed records
    const devices: Device[] = rows.map((row: any[]) => ({
      name: row[0],
      deviceId: Number(row[1]),
      deviceType: row[2],
      // Skip deviceUUID, lat, lon, preference, locationName, roomType, spaceType, macAddress, timezone (indices 3-11)
      lastUpdated: row[12],
      active: Boolean(row[13]),
      dataPath: row[14],
    }))

    // Filter to active devices only
    const activeDevices = devices.filter(d => d.active !== false)

    console.log(`📋 Loaded ${activeDevices.length} active devices`)
    return activeDevices
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to fetch devices from S3: ${message}`)
  }
}

// Alias for backwards compatibility
const getParquetUrl = getDataUrl

// Data collection assumptions for row group optimization
const ROWS_PER_MINUTE = 1
const DEFAULT_DAYS_TO_LOAD = 7 // Default to last 7 days on initial load

export async function fetchAwairData(deviceId?: number): Promise<{ records: AwairRecord[]; summary: DataSummary }> {
  // If no device ID provided, use first available device
  if (!deviceId) {
    const devices = await fetchDevices()
    if (devices.length === 0) {
      throw new Error('No devices found')
    }
    deviceId = devices[0].deviceId
  }

  const url = getParquetUrl(deviceId)
  console.log(`🔄 Fetching data from device ${deviceId}...`)

  // Use asyncBufferFromUrl to enable HTTP Range Requests
  const file = await asyncBufferFromUrl({ url })

  // Fetch metadata to determine file structure and date range
  const metadata = await parquetMetadataAsync(file)
  const totalRows = Number(metadata.num_rows)
  const numRowGroups = metadata.row_groups.length

  console.log(`📦 File has ${numRowGroups} row groups, ${totalRows} total rows`)

  // Calculate how many rows to fetch for default view (last N days)
  const defaultMinutes = DEFAULT_DAYS_TO_LOAD * 24 * 60
  const expectedRows = Math.min(defaultMinutes * ROWS_PER_MINUTE * 1.5, totalRows) // 1.5x safety margin
  const rowsToFetch = Math.ceil(expectedRows)

  // Parquet files are typically sorted oldest-to-newest, so fetch from the end
  const rowStart = Math.max(0, totalRows - rowsToFetch)
  const rowEnd = totalRows

  console.log(`📥 Fetching rows ${rowStart}-${rowEnd} (last ${rowsToFetch} rows, ~${DEFAULT_DAYS_TO_LOAD} days)`)

  let rows: any[] = []
  await parquetRead({
    file,
    rowStart,
    rowEnd,
    onComplete: (data) => {
      if (Array.isArray(data)) {
        rows = data
      }
    }
  })

  if (rows.length === 0) {
    throw new Error('No data found in Parquet file')
  }

  // Convert array format to typed records
  const records: AwairRecord[] = rows.map((row: any[]) => ({
    timestamp: row[0],
    temp: Number(row[1]),
    co2: Number(row[2]),
    pm10: Number(row[3]),
    pm25: Number(row[4]),
    humid: Number(row[5]),
    voc: Number(row[6]),
  }))

  // Sort by timestamp (newest first)
  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Calculate summary from fetched data
  const count = records.length
  const latest = count > 0 ? records[0].timestamp : null
  const earliest = count > 0 ? records[count - 1].timestamp : null

  let dateRange = 'No data'
  if (earliest && latest) {
    const formatCompactDate = (date: Date) => {
      const month = String(date.getMonth() + 1)
      const day = String(date.getDate())
      const year = String(date.getFullYear()).slice(-2)
      return `${month}/${day}/${year}`
    }

    const start = formatCompactDate(new Date(earliest))
    const end = formatCompactDate(new Date(latest))
    dateRange = start === end ? start : `${start} - ${end}`
  }

  const summary: DataSummary = { count, earliest, latest, dateRange }

  console.log(`✅ Fetched ${count} records (${earliest} to ${latest})`)

  return { records, summary }
}
