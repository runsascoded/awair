/**
 * Data source implementation using hyparquet for direct S3 reads.
 * Uses HTTP Range Requests to fetch only required row groups.
 */

import { parquetRead } from 'hyparquet'
import type { AwairRecord } from '../../types/awair'
import { getDataUrl } from '../awairService'
import type { DataSource, FetchOptions, FetchResult, FetchTiming } from '../dataSource'

export class HyparquetSource implements DataSource {
  readonly type = 's3-hyparquet' as const
  readonly name = 'S3 Direct (hyparquet)'

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const { deviceId, range } = options
    const url = getDataUrl(deviceId)

    const startTime = performance.now()
    let networkEndTime = startTime
    let bytesTransferred = 0

    // Fetch the entire file for now
    // TODO: Use asyncBufferFromUrl with rowStart/rowEnd once we have multiple row groups
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    networkEndTime = performance.now()
    bytesTransferred = arrayBuffer.byteLength

    // Parse parquet
    let rows: any[] = []
    await parquetRead({
      file: arrayBuffer,
      onComplete: (data) => {
        if (Array.isArray(data)) {
          rows = data
        }
      }
    })

    // Convert to typed records and filter by time range
    const fromTime = range.from.getTime()
    const toTime = range.to.getTime()

    const records: AwairRecord[] = rows
      .map((row: any[]) => ({
        timestamp: row[0],
        temp: Number(row[1]),
        co2: Number(row[2]),
        pm10: Number(row[3]),
        pm25: Number(row[4]),
        humid: Number(row[5]),
        voc: Number(row[6]),
      }))
      .filter(record => {
        const ts = new Date(record.timestamp).getTime()
        return ts >= fromTime && ts <= toTime
      })

    // Sort by timestamp (newest first)
    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const endTime = performance.now()

    const timing: FetchTiming = {
      totalMs: endTime - startTime,
      networkMs: networkEndTime - startTime,
      parseMs: endTime - networkEndTime,
      bytesTransferred,
      source: this.type,
    }

    return { records, timing }
  }
}
