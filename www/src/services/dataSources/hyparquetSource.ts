/**
 * Data source implementation using hyparquet for direct S3 reads.
 * Uses ParquetCache for intelligent row-group-level caching with Range Requests.
 *
 * Supports monthly sharding: data is stored in files like awair-{id}/{YYYY-MM}.parquet.
 * For a given time range, fetches from all relevant monthly files and combines results.
 */

import { getMonthlyDataUrls, getMonthlyDataUrl } from '../awairService'
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
/** Track failed URLs to avoid repeated 404 attempts */
const failedUrls = new Set<string>()

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

/** Result from fetching a single monthly file */
interface MonthlyFetchResult {
  url: string
  records: AwairRecord[]
  rows: number
  bytesTransferred: number
  lastModified?: Date
}

export class HyparquetSource implements DataSource {
  readonly type = 's3-hyparquet' as const
  readonly name = 'S3 Direct (hyparquet)'

  /** Get cache for a URL (if it exists and is initialized) */
  getCache(url: string): ParquetCache | null {
    const cache = cacheManager.get(url)
    return (cache && cache.getMetadata()) ? cache : null
  }

  /**
   * Fetch records from a single monthly parquet file.
   * Returns null if file doesn't exist (404).
   */
  private async fetchFromUrl(
    url: string,
    deviceId: number,
    fromTime: number,
    toTime: number
  ): Promise<MonthlyFetchResult | null> {
    // Skip URLs that have previously 404'd
    if (failedUrls.has(url)) {
      return null
    }

    try {
      const cache = await getCache(url)

      // NOTE: We intentionally do NOT call cache.refresh() here.
      // For append-only files, refreshing (checking S3 for new data) is handled
      // exclusively by the smart polling infrastructure.

      const rgInfos = cache.getRowGroupInfos()
      const numRowGroups = rgInfos.length

      // Use timestamp stats to find row groups that overlap the requested range
      const neededRGs = cache.getRowGroupsForRange(new Date(fromTime), new Date(toTime))

      if (neededRGs.length === 0) {
        return { url, records: [], rows: 0, bytesTransferred: 0, lastModified: cache.getLastModified() ?? undefined }
      }

      const neededIndices = neededRGs.map(rg => rg.index).join(',')
      console.log(`[${deviceId}] 📥 ${url.split('/').slice(-2).join('/')}: RGs [${neededIndices}] (${neededRGs.length}/${numRowGroups})`)

      // Calculate row range from needed RGs
      const firstRgIndex = neededRGs[0].index
      const lastRgIndex = neededRGs[neededRGs.length - 1].index

      let rowStart = 0
      for (let i = 0; i < firstRgIndex; i++) {
        rowStart += rgInfos[i].numRows
      }

      let rowEnd = rowStart
      for (let i = firstRgIndex; i <= lastRgIndex; i++) {
        rowEnd += rgInfos[i].numRows
      }

      // Read rows (cache handles fetching missing RGs)
      let rows: AwairRow[] = []
      await cache.readRows<AwairRow>(rowStart, rowEnd, (data) => {
        rows = data
      })

      const stats = cache.getStats()

      // Convert to typed records and filter by time range
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

      return {
        url,
        records,
        rows: rows.length,
        bytesTransferred: stats.cacheSize,
        lastModified: cache.getLastModified() ?? undefined,
      }
    } catch (error) {
      // Handle 404s gracefully - file doesn't exist yet (future month or not migrated)
      if (error instanceof Error && (error.message.includes('404') || error.message.includes('Not Found'))) {
        console.log(`[${deviceId}] ⚠️ ${url.split('/').slice(-2).join('/')} not found (404)`)
        failedUrls.add(url)
        return null
      }
      throw error
    }
  }

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const { deviceId, range } = options
    const startTime = performance.now()

    console.log(`[${deviceId}] ⏱️ Time range: ${range.from.toISOString()} to ${range.to.toISOString()}`)

    // Get all monthly URLs that could contain data for this range
    const urls = getMonthlyDataUrls(deviceId, range.from, range.to)
    console.log(`[${deviceId}] 📂 Fetching from ${urls.length} monthly file(s)`)

    const fromTime = range.from.getTime()
    const toTime = range.to.getTime()

    // Fetch from all monthly files in parallel
    const results = await Promise.all(
      urls.map(url => this.fetchFromUrl(url, deviceId, fromTime, toTime))
    )

    // Filter out null results (404s) and combine records
    const successfulResults = results.filter((r): r is MonthlyFetchResult => r !== null)

    const readEndTime = performance.now()

    // Combine all records
    const allRecords: AwairRecord[] = successfulResults.flatMap(r => r.records)
    const totalRows = successfulResults.reduce((sum, r) => sum + r.rows, 0)
    const totalBytes = successfulResults.reduce((sum, r) => sum + r.bytesTransferred, 0)

    // Sort by timestamp (newest first)
    allRecords.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    const endTime = performance.now()

    console.log(`[${deviceId}] ✅ Fetched ${allRecords.length} records from ${successfulResults.length} file(s) (${totalRows} rows read)`)

    // Use the most recent lastModified from successful results
    const lastModified = successfulResults
      .map(r => r.lastModified)
      .filter((d): d is Date => d !== undefined)
      .sort((a, b) => b.getTime() - a.getTime())[0]

    const timing: FetchTiming = {
      totalMs: endTime - startTime,
      networkMs: readEndTime - startTime,
      parseMs: endTime - readEndTime,
      bytesTransferred: totalBytes,
      source: this.type,
    }

    return { records: allRecords, timing, lastModified }
  }

  /**
   * Refresh cache for a device (check for new data).
   * Only refreshes the current month's file (historical months are immutable).
   * Returns true if new data was available.
   */
  async refresh(deviceId: number): Promise<boolean> {
    const url = getCurrentMonthUrl(deviceId)
    const cache = cacheManager.get(url)
    if (!cache) return false

    const hadNewData = await cache.refresh()
    if (hadNewData) {
      const stats = cache.getStats()
      console.log(`[${deviceId}] 🔄 Refreshed cache: ${stats.totalRowGroups} RGs, ${(stats.cacheSize / 1024).toFixed(0)}KB cached`)
    }
    return hadNewData
  }

  /** Get cache stats for a device (current month's file) */
  getCacheStats(deviceId: number): ReturnType<ParquetCache['getStats']> | null {
    const url = getCurrentMonthUrl(deviceId)
    const cache = cacheManager.get(url)
    return cache?.getStats() ?? null
  }

  /** Get file bounds (earliest/latest timestamps) across all cached monthly files for a device */
  getFileBounds(deviceId: number): { earliest: Date; latest: Date } | null {
    // Find all cached monthly files for this device
    const devicePrefix = `awair-${deviceId}/`
    const deviceCaches: ParquetCache[] = []

    for (const [url, cache] of cacheManager.entries()) {
      if (url.includes(devicePrefix) && cache.getMetadata()) {
        deviceCaches.push(cache)
      }
    }

    if (deviceCaches.length === 0) return null

    // Aggregate min/max timestamps across all caches
    let earliest: Date | null = null
    let latest: Date | null = null

    for (const cache of deviceCaches) {
      const rgInfos = cache.getRowGroupInfos()
      for (const rg of rgInfos) {
        if (rg.minTimestamp && (!earliest || rg.minTimestamp < earliest)) {
          earliest = rg.minTimestamp
        }
        if (rg.maxTimestamp && (!latest || rg.maxTimestamp > latest)) {
          latest = rg.maxTimestamp
        }
      }
    }

    if (!earliest || !latest) return null
    return { earliest, latest }
  }
}

/** Get URL for the current month's parquet file */
function getCurrentMonthUrl(deviceId: number): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return getMonthlyDataUrl(deviceId, `${year}-${month}`)
}
