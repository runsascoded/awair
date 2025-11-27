/**
 * Data source implementation using hyparquet for direct S3 reads.
 * Uses HTTP Range Requests to fetch only required row groups.
 */

import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from 'hyparquet'
import { getDataUrl } from '../awairService'
import type { AwairRecord } from '../../types/awair'
import type { DataSource, FetchOptions, FetchResult, FetchTiming } from '../dataSource'

// Parquet row tuple type (match column order: timestamp, temp, co2, pm10, pm25, humid, voc)
type AwairRow = [string, number, number, number, number, number, number]

// Data collection assumptions
const ROWS_PER_MINUTE = 1 // Expected data density: ~1 row per minute
const ROWS_PER_GROUP = 10000 // Row group size configured in storage layer
const SAFETY_MARGIN = 1.5 // Fetch extra row groups to account for gaps/variations

export class HyparquetSource implements DataSource {
  readonly type = 's3-hyparquet' as const
  readonly name = 'S3 Direct (hyparquet)'

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const { deviceId, range } = options
    const url = getDataUrl(deviceId)

    const startTime = performance.now()
    let bytesTransferred = 0

    // Create async buffer for range requests
    const file = await asyncBufferFromUrl({ url })

    // Fetch metadata to determine row group structure
    const metadata = await parquetMetadataAsync(file)
    const totalRows = Number(metadata.num_rows)
    const numRowGroups = metadata.row_groups.length

    console.log(`📦 File has ${numRowGroups} row groups, ${totalRows} total rows`)

    // Calculate expected rows needed based on time range
    const rangeMinutes = (range.to.getTime() - range.from.getTime()) / (1000 * 60)
    const expectedRows = Math.ceil(rangeMinutes * ROWS_PER_MINUTE * SAFETY_MARGIN)
    const expectedRowGroups = Math.ceil(expectedRows / ROWS_PER_GROUP)

    console.log(`⏱️  Time range: ${rangeMinutes.toFixed(0)} minutes → expecting ~${expectedRows} rows in ~${expectedRowGroups} row groups`)

    // Calculate row range to fetch
    // Assume data is sorted newest-to-oldest, so latest data is at the beginning
    const rowStart = 0
    let rowEnd = Math.min(expectedRows, totalRows)

    // If file has only 1 row group, or expecting most/all rows, fetch everything
    // This handles legacy files not yet partitioned into smaller row groups
    if (numRowGroups === 1 || expectedRowGroups >= numRowGroups || expectedRows >= totalRows * 0.8) {
      console.log('📥 Fetching all rows (file has 1 row group or large time range requested)')
      rowEnd = totalRows
    } else {
      console.log(`📥 Fetching rows ${rowStart}-${rowEnd} (${expectedRowGroups}/${numRowGroups} row groups)`)
    }

    const networkStartTime = performance.now()

    // Parse parquet with row range
    let rows: AwairRow[] = []
    await parquetRead({
      file,
      rowStart,
      rowEnd,
      onComplete: (data) => {
        if (Array.isArray(data)) {
          rows = data as AwairRow[]
        }
      }
    })

    const networkEndTime = performance.now()

    // Estimate bytes transferred (file.byteLength won't work with async buffer)
    // Use metadata to estimate: (rows fetched / total rows) * assumed file size
    const estimatedFileSize = totalRows * 40 // ~40 bytes per row estimate
    bytesTransferred = Math.ceil((rows.length / totalRows) * estimatedFileSize)

    // Convert to typed records and filter by time range
    const fromTime = range.from.getTime()
    const toTime = range.to.getTime()

    const records: AwairRecord[] = rows
      .map((row) => ({
        timestamp: row[0],
        temp: row[1],
        co2: row[2],
        pm10: row[3],
        pm25: row[4],
        humid: row[5],
        voc: row[6],
      }))
      .filter(record => {
        const ts = new Date(record.timestamp).getTime()
        return ts >= fromTime && ts <= toTime
      })

    // Sort by timestamp (newest first)
    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const endTime = performance.now()

    console.log(`✅ Fetched ${records.length} records matching time range (from ${rows.length} rows read)`)

    const timing: FetchTiming = {
      totalMs: endTime - startTime,
      networkMs: networkEndTime - networkStartTime,
      parseMs: endTime - networkEndTime,
      bytesTransferred,
      source: this.type,
    }

    return { records, timing }
  }
}
