/**
 * Data source implementation using hyparquet for direct S3 reads.
 * Uses ParquetCache for intelligent row-group-level caching with Range Requests.
 */

import { getDataUrl } from '../awairService'
import { ParquetCache } from '../parquetCache'
import type { AwairRecord } from '../../types/awair'
import type { DataSource, FetchOptions, FetchResult, FetchTiming } from '../dataSource'

// Parquet row tuple type (match column order: timestamp, temp, co2, pm10, pm25, humid, voc)
// Note: timestamp is Date object, temp/humid are float (number), others are BigInt
type AwairRow = [Date, number, bigint, bigint, bigint, number, bigint]

/** Global cache manager - one ParquetCache per URL */
const cacheManager = new Map<string, ParquetCache>()
/** Pending initialization promises - prevents concurrent init */
const initPromises = new Map<string, Promise<ParquetCache>>()

/** Get or create a ParquetCache for a URL */
async function getCache(url: string): Promise<ParquetCache> {
  // Return existing initialized cache
  const existing = cacheManager.get(url)
  if (existing && existing.getMetadata()) {
    return existing
  }

  // Wait for pending initialization
  const pending = initPromises.get(url)
  if (pending) {
    return pending
  }

  // Start new initialization
  const initPromise = (async () => {
    const cache = new ParquetCache(url)
    await cache.initialize()
    cacheManager.set(url, cache)
    initPromises.delete(url)
    return cache
  })()

  initPromises.set(url, initPromise)
  return initPromise
}

/** Clear all caches (for testing or memory pressure) */
export function clearCaches(): void {
  cacheManager.clear()
  initPromises.clear()
}

export class HyparquetSource implements DataSource {
  readonly type = 's3-hyparquet' as const
  readonly name = 'S3 Direct (hyparquet)'

  /** Get cache for a URL (if it exists and is initialized) */
  getCache(url: string): ParquetCache | null {
    const cache = cacheManager.get(url)
    return (cache && cache.getMetadata()) ? cache : null
  }

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const { deviceId, range } = options
    const url = getDataUrl(deviceId)

    const startTime = performance.now()

    // Get or initialize cache for this URL
    const cache = await getCache(url)

    // Check for new data on S3 (only does HEAD + tail fetch if file grew)
    const hadNewData = await cache.refresh()

    const metadata = cache.getMetadata()!
    const rgInfos = cache.getRowGroupInfos()

    if (hadNewData) {
      // Calculate e2e latency from latest data point
      const lastRg = rgInfos[rgInfos.length - 1]
      const latestTs = lastRg?.maxTimestamp
      const lastModified = cache.getLastModified()
      const now = Date.now()

      if (latestTs) {
        const e2eLatencyMs = now - latestTs.getTime()
        const e2eLatencySec = (e2eLatencyMs / 1000).toFixed(1)
        // Browser lag = time since S3 was modified (how long browser took to notice)
        const browserLagMs = lastModified ? now - lastModified.getTime() : null
        const browserLagSec = browserLagMs !== null ? (browserLagMs / 1000).toFixed(1) : '?'
        console.log(`🔄 Cache refreshed with new data (e2e: ${e2eLatencySec}s, browser lag: ${browserLagSec}s)`)
      } else {
        console.log(`🔄 Cache refreshed with new data`)
      }
    }

    const totalRows = Number(metadata.num_rows)
    const numRowGroups = rgInfos.length

    console.log(`📦 File has ${numRowGroups} row groups, ${totalRows} total rows`)

    // Use timestamp stats to find row groups that overlap the requested range
    const neededRGs = cache.getRowGroupsForRange(range.from, range.to)
    console.log(`⏱️  Time range: ${range.from.toISOString()} to ${range.to.toISOString()}`)
    console.log(`📥 Need ${neededRGs.length}/${numRowGroups} row groups based on timestamp stats`)

    if (neededRGs.length === 0) {
      // No data in range
      const endTime = performance.now()
      return {
        records: [],
        timing: {
          totalMs: endTime - startTime,
          networkMs: 0,
          parseMs: endTime - startTime,
          bytesTransferred: 0,
          source: this.type,
        },
      }
    }

    // Calculate row range from needed RGs
    const firstRgIndex = neededRGs[0].index
    const lastRgIndex = neededRGs[neededRGs.length - 1].index

    // Sum rows before first needed RG
    let rowStart = 0
    for (let i = 0; i < firstRgIndex; i++) {
      rowStart += rgInfos[i].numRows
    }

    // Sum rows through last needed RG
    let rowEnd = rowStart
    for (let i = firstRgIndex; i <= lastRgIndex; i++) {
      rowEnd += rgInfos[i].numRows
    }

    const networkStartTime = performance.now()

    // Read rows (cache handles fetching missing RGs)
    let rows: AwairRow[] = []
    await cache.readRows<AwairRow>(rowStart, rowEnd, (data) => {
      rows = data
    })

    const networkEndTime = performance.now()

    // Estimate bytes transferred from cache stats
    const stats = cache.getStats()
    const bytesTransferred = stats.cacheSize

    // Convert to typed records and filter by time range
    const fromTime = range.from.getTime()
    const toTime = range.to.getTime()

    // Note: co2, pm10, pm25, voc are BigInt from parquet, convert to Number
    const records: AwairRecord[] = rows
      .map((row) => ({
        timestamp: row[0],
        temp: row[1],
        co2: Number(row[2]),
        pm10: Number(row[3]),
        pm25: Number(row[4]),
        humid: row[5],
        voc: Number(row[6]),
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

    return { records, timing, lastModified: cache.getLastModified() ?? undefined }
  }

  /**
   * Refresh cache for a device (check for new data).
   * Returns true if new data was available.
   */
  async refresh(deviceId: number): Promise<boolean> {
    const url = getDataUrl(deviceId)
    const cache = cacheManager.get(url)
    if (!cache) return false

    const hadNewData = await cache.refresh()
    if (hadNewData) {
      const stats = cache.getStats()
      console.log(`🔄 Refreshed cache: ${stats.totalRowGroups} RGs, ${(stats.cacheSize / 1024).toFixed(0)}KB cached`)
    }
    return hadNewData
  }

  /** Get cache stats for a device */
  getCacheStats(deviceId: number): ReturnType<ParquetCache['getStats']> | null {
    const url = getDataUrl(deviceId)
    const cache = cacheManager.get(url)
    return cache?.getStats() ?? null
  }
}
