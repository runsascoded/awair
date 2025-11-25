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
const SAFETY_MARGIN = 1.5

export async function fetchAwairData(
  deviceId: number | undefined,
  timeRange: { timestamp: Date | null; duration: number }
): Promise<{ records: AwairRecord[]; summary: DataSummary }> {
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

  // Fetch metadata to determine file structure
  const metadata = await parquetMetadataAsync(file)
  const totalRows = Number(metadata.num_rows)
  const numRowGroups = metadata.row_groups.length

  console.log(`📦 File has ${numRowGroups} row groups, ${totalRows} total rows`)

  // Extract file date range from row group statistics (timestamp is column 0)
  let fileEarliest: string | null = null
  let fileLatest: string | null = null

  for (const rowGroup of metadata.row_groups) {
    const timestampColumn = rowGroup.columns[0] // timestamp is first column
    const stats = timestampColumn.meta_data?.statistics
    if (stats) {
      // min_value is the earliest timestamp in this row group
      if (stats.min_value && (!fileEarliest || stats.min_value < fileEarliest)) {
        fileEarliest = stats.min_value as string
      }
      // max_value is the latest timestamp in this row group
      if (stats.max_value && (!fileLatest || stats.max_value > fileLatest)) {
        fileLatest = stats.max_value as string
      }
    }
  }

  console.log(`📅 File date range: ${fileEarliest} to ${fileLatest}`)

  // Calculate expected rows based on requested time range
  const rangeMinutes = timeRange.duration / (1000 * 60)
  const expectedRows = Math.ceil(rangeMinutes * ROWS_PER_MINUTE * SAFETY_MARGIN)
  const expectedRowGroups = Math.ceil(expectedRows / 10000) // Assuming 10k rows per group

  // Determine fetch strategy
  let rowStart = 0
  let rowEnd = totalRows

  if (numRowGroups > 1 && expectedRows < totalRows * 0.8) {
    // Fetch only needed rows from the end (newest data)
    rowEnd = totalRows
    rowStart = Math.max(0, totalRows - expectedRows)
    console.log(`📥 Fetching rows ${rowStart}-${rowEnd} (~${expectedRowGroups}/${numRowGroups} row groups for ${(rangeMinutes / 60 / 24).toFixed(0)} days)`)
  } else {
    // Fetch all rows
    console.log(`📥 Fetching all rows (${numRowGroups} row groups, entire history)`)
  }

  let rows: any[] = []
  await parquetRead({
    file,
    ...(rowStart > 0 ? { rowStart, rowEnd } : {}),
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

  // Calculate summary using file-level metadata (not just fetched records)
  const count = records.length

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

  // Summary uses file-level timestamps from metadata, not fetched data
  const summary: DataSummary = { count, earliest: fileEarliest, latest: fileLatest, dateRange }

  console.log(`✅ Fetched ${count} records (file spans ${fileEarliest} to ${fileLatest})`)

  return { records, summary }
}
