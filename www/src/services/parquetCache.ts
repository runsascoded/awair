/**
 * ParquetCache - Intelligent caching layer for Parquet files over HTTP.
 *
 * Optimized for append-only time-series data with these properties:
 * - Row groups (RGs) are contiguous in the file
 * - Columns are contiguous within each RG
 * - Only the last RG changes (grows); all prior RGs are immutable
 * - Footer metadata is small (~24KB) but contains byte offsets for all RGCs
 *
 * Caching strategy:
 * - Cache complete RGs in an LRU cache with size-based eviction
 * - Initial fetch: last 128KB (gets footer + ~1 recent RG)
 * - Refresh: fetch from last RG start to EOF (~100KB, just last RG + footer)
 *   - This picks up new RGs automatically when last RG fills up
 *   - Always gets fresh footer metadata
 * - On-demand: fetch additional RGs in single coalesced Range request
 *
 * Key insight: Once we have the footer, we know exact byte ranges for every
 * {RG × column} chunk. RGs before the last are immutable and can be cached
 * indefinitely (subject to LRU eviction for memory limits).
 */

import { parquetMetadataAsync, parquetRead } from 'hyparquet'
import { LRUCache } from './lruCache'
import type { LRUCacheOptions } from './lruCache'
import type { AsyncBuffer, ColumnChunk, FileMetaData } from 'hyparquet'

/** Row group metadata with byte range info */
export interface RowGroupInfo {
  index: number
  startByte: number
  endByte: number
  numRows: number
  minTimestamp?: Date
  maxTimestamp?: Date
}

export interface ParquetCacheOptions {
  /** Initial fetch size in bytes (default: 128KB) - for the first network request */
  initialFetchSize?: number
  /** LRU cache options for RG blobs */
  cacheOptions?: LRUCacheOptions
  /** Custom fetch function (for testing) */
  fetch?: typeof globalThis.fetch
}

export interface CacheStats {
  fileSize: number
  metadataSize: number
  totalRowGroups: number
  cachedRowGroups: number
  cacheSize: number
  cacheMaxSize: number
  cacheUtilization: number
}

/**
 * Cached Parquet file with RG-level granularity.
 */
export class ParquetCache {
  private url: string
  private fileSize: number = 0
  private metadata: FileMetaData | null = null
  private lastModified: Date | null = null

  /** Row group metadata (always complete after init) */
  private rowGroupInfos: RowGroupInfo[] = []

  /** LRU cache for RG data blobs */
  private blobCache: LRUCache

  /** Byte range of currently cached contiguous data from end of file */
  private tailCacheStart: number = 0
  private tailCache: ArrayBuffer | null = null

  private initialFetchSize: number
  private fetchFn: typeof globalThis.fetch

  constructor(url: string, options: ParquetCacheOptions = {}) {
    this.url = url
    this.initialFetchSize = options.initialFetchSize ?? (1 << 17) // 128KB
    // Bind fetch to globalThis to preserve context when called as this.fetchFn()
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.blobCache = new LRUCache(options.cacheOptions ?? {})
  }

  /**
   * Initialize the cache with initial fetch.
   * Fetches footer + recent row groups in one request.
   */
  async initialize(): Promise<FileMetaData> {
    // HEAD request to get file size and Last-Modified
    const headRes = await this.fetchFn(this.url, { method: 'HEAD' })
    if (!headRes.ok) throw new Error(`HEAD failed: ${headRes.status}`)

    const contentLength = headRes.headers.get('Content-Length')
    if (!contentLength) throw new Error('Missing Content-Length header')
    this.fileSize = parseInt(contentLength)

    // Capture Last-Modified for smart polling
    const lastModifiedHeader = headRes.headers.get('Last-Modified')
    if (lastModifiedHeader) {
      this.lastModified = new Date(lastModifiedHeader)
    }

    // Fetch last N bytes (footer + some row groups)
    this.tailCacheStart = Math.max(0, this.fileSize - this.initialFetchSize)
    const rangeHeader = `bytes=${this.tailCacheStart}-${this.fileSize - 1}`

    const res = await this.fetchFn(this.url, {
      headers: { Range: rangeHeader },
    })

    if (!res.ok) throw new Error(`Initial fetch failed: ${res.status}`)
    this.tailCache = await res.arrayBuffer()

    // Parse metadata using our cached async buffer
    const asyncBuffer = this.createAsyncBuffer()
    this.metadata = await parquetMetadataAsync(asyncBuffer, { initialFetchSize: this.initialFetchSize })

    // Index all row groups
    this.indexRowGroups()

    // Move fully-cached RGs from tail cache to blob cache
    this.promoteCompletedRowGroups()

    return this.metadata
  }

  /**
   * Refresh from last RG start to EOF.
   * Returns true if new data was available.
   */
  async refresh(): Promise<boolean> {
    if (!this.metadata || this.rowGroupInfos.length === 0) {
      throw new Error('Not initialized')
    }

    // HEAD to check file size
    const headRes = await this.fetchFn(this.url, { method: 'HEAD' })
    if (!headRes.ok) throw new Error(`HEAD failed: ${headRes.status}`)

    const contentLength = headRes.headers.get('Content-Length')
    if (!contentLength) throw new Error('Missing Content-Length header')

    const newFileSize = parseInt(contentLength)

    // Capture Last-Modified header
    const lastModifiedHeader = headRes.headers.get('Last-Modified')
    if (lastModifiedHeader) {
      this.lastModified = new Date(lastModifiedHeader)
    }

    // If file hasn't changed, nothing to do
    if (newFileSize === this.fileSize) {
      return false
    }

    const oldRgCount = this.rowGroupInfos.length
    const oldFileSize = this.fileSize

    // Fetch from last RG start to EOF
    // This fetches ~90-160KB (last RG + footer), which is > metadataFetchSize (64KB)
    const lastRgInfo = this.rowGroupInfos[this.rowGroupInfos.length - 1]
    const fetchStart = lastRgInfo.startByte

    console.log(`🔄 Refresh: file size ${oldFileSize} → ${newFileSize}, fetching from byte ${fetchStart}`)

    const res = await this.fetchFn(this.url, {
      headers: { Range: `bytes=${fetchStart}-` }, // Open-ended!
    })

    if (!res.ok) throw new Error(`Refresh fetch failed: ${res.status}`)

    // Update state
    this.fileSize = newFileSize
    this.tailCacheStart = fetchStart
    this.tailCache = await res.arrayBuffer()

    // Invalidate last RG from blob cache (it may have grown)
    const lastRgKey = this.rgKey(lastRgInfo.index)
    this.blobCache.delete(lastRgKey)

    // Re-parse metadata (footer may have changed)
    // Use suffixStart to tell hyparquet exactly where our cached data starts
    const asyncBuffer = this.createAsyncBuffer()
    this.metadata = await parquetMetadataAsync(asyncBuffer, { suffixStart: fetchStart })

    // Re-index row groups (may have new RGs)
    this.indexRowGroups()

    const newRgCount = this.rowGroupInfos.length

    // Detect major structural change (RG count changed significantly)
    if (Math.abs(newRgCount - oldRgCount) > 5 || newFileSize < oldFileSize * 0.8) {
      console.warn(`⚠️ Major file restructure detected: ${oldRgCount} → ${newRgCount} RGs, clearing cache and reinitializing`)
      this.blobCache.clear()
      this.tailCache = null
      await this.initialize()
      return true
    }

    console.log(`✅ Refresh complete: ${oldRgCount} → ${newRgCount} RGs, tail cache ${this.tailCache.byteLength} bytes`)

    // Promote newly-completed RGs to blob cache
    this.promoteCompletedRowGroups()

    return true
  }

  /**
   * Get row groups that overlap a time range.
   */
  getRowGroupsForRange(from: Date, to: Date): RowGroupInfo[] {
    const fromTime = from.getTime()
    const toTime = to.getTime()

    return this.rowGroupInfos.filter(rg => {
      // RG overlaps if: rg.max >= from AND rg.min <= to
      const rgMin = rg.minTimestamp?.getTime() ?? 0
      const rgMax = rg.maxTimestamp?.getTime() ?? Infinity
      return rgMax >= fromTime && rgMin <= toTime
    })
  }

  /**
   * Ensure row groups are cached.
   * Fetches any missing RGs in a single coalesced Range request.
   */
  async ensureRowGroupsCached(indices: number[]): Promise<void> {
    if (!this.metadata) throw new Error('Not initialized')

    // Find which row groups need fetching
    const missing = indices.filter(i => {
      const key = this.rgKey(i)
      // Check blob cache first, then tail cache
      if (this.blobCache.has(key)) return false
      const rg = this.rowGroupInfos[i]
      if (!rg) return true
      // Check if fully in tail cache
      return !this.isInTailCache(rg.startByte, rg.endByte)
    })

    if (missing.length === 0) return

    // Sort and find contiguous range
    missing.sort((a, b) => a - b)
    const minIndex = missing[0]
    const maxIndex = missing[missing.length - 1]

    const firstRg = this.rowGroupInfos[minIndex]
    const lastRg = this.rowGroupInfos[maxIndex]
    if (!firstRg || !lastRg) throw new Error('Row group metadata missing')

    // Fetch the contiguous range
    const fetchStart = firstRg.startByte
    const fetchEnd = lastRg.endByte

    console.log(`📥 Fetching RGs ${minIndex}-${maxIndex}: bytes ${fetchStart}-${fetchEnd - 1}`)

    const res = await this.fetchFn(this.url, {
      headers: { Range: `bytes=${fetchStart}-${fetchEnd - 1}` },
    })

    if (!res.ok) throw new Error(`Fetch RGs failed: ${res.status}`)

    const data = await res.arrayBuffer()

    // Store each RG in blob cache
    for (const rgIndex of missing) {
      const rg = this.rowGroupInfos[rgIndex]
      const rgStart = rg.startByte - fetchStart
      const rgEnd = rg.endByte - fetchStart
      const rgData = data.slice(rgStart, rgEnd)
      this.blobCache.set(this.rgKey(rgIndex), rgData)
    }
  }

  /**
   * Read rows from cached data.
   */
  async readRows<T>(
    rowStart: number,
    rowEnd: number,
    onComplete: (rows: T[]) => void
  ): Promise<void> {
    if (!this.metadata) throw new Error('Not initialized')

    // Determine which RGs we need
    const neededRgIndices = this.getRowGroupIndicesForRows(rowStart, rowEnd)

    // Ensure they're cached
    await this.ensureRowGroupsCached(neededRgIndices)

    // Create async buffer and read
    const asyncBuffer = this.createAsyncBuffer()

    await parquetRead({
      file: asyncBuffer,
      metadata: this.metadata,
      rowStart,
      rowEnd,
      onComplete: (data) => {
        if (Array.isArray(data)) {
          onComplete(data as T[])
        }
      },
    })
  }

  /** Get current metadata */
  getMetadata(): FileMetaData | null {
    return this.metadata
  }

  /** Get row group infos */
  getRowGroupInfos(): RowGroupInfo[] {
    return this.rowGroupInfos
  }

  /** Get file size */
  getFileSize(): number {
    return this.fileSize
  }

  /** Get last modified time from S3 */
  getLastModified(): Date | null {
    return this.lastModified
  }

  /** Get cache statistics */
  getStats(): CacheStats {
    const cacheStats = this.blobCache.stats()
    const cachedRGs = this.rowGroupInfos.filter(rg =>
      this.blobCache.has(this.rgKey(rg.index)) || this.isInTailCache(rg.startByte, rg.endByte)
    ).length

    return {
      fileSize: this.fileSize,
      metadataSize: this.metadata?.metadata_length ?? 0,
      totalRowGroups: this.rowGroupInfos.length,
      cachedRowGroups: cachedRGs,
      cacheSize: cacheStats.size + (this.tailCache?.byteLength ?? 0),
      cacheMaxSize: cacheStats.maxSize,
      cacheUtilization: cacheStats.utilization,
    }
  }

  // --- Private methods ---

  private rgKey(index: number): string {
    return `rg-${index}`
  }

  private isInTailCache(startByte: number, endByte: number): boolean {
    if (!this.tailCache) return false
    const tailEnd = this.tailCacheStart + this.tailCache.byteLength
    return startByte >= this.tailCacheStart && endByte <= tailEnd
  }

  private getRowGroupIndicesForRows(rowStart: number, rowEnd: number): number[] {
    const indices: number[] = []
    let currentRow = 0

    for (const rg of this.rowGroupInfos) {
      const rgEnd = currentRow + rg.numRows
      if (rgEnd > rowStart && currentRow < rowEnd) {
        indices.push(rg.index)
      }
      currentRow = rgEnd
      if (currentRow >= rowEnd) break
    }

    return indices
  }

  private createAsyncBuffer(): AsyncBuffer {
    return {
      byteLength: this.fileSize,
      slice: async (start: number, end?: number) => {
        const actualEnd = end ?? this.fileSize
        const length = actualEnd - start

        // Try single-source fast paths first

        // 1. Check if entire range is in tail cache
        if (this.isInTailCache(start, actualEnd)) {
          const offsetStart = start - this.tailCacheStart
          const offsetEnd = actualEnd - this.tailCacheStart
          return this.tailCache!.slice(offsetStart, offsetEnd)
        }

        // 2. Check if entire range fits in a single RG in blob cache
        for (const rg of this.rowGroupInfos) {
          if (start >= rg.startByte && actualEnd <= rg.endByte) {
            const cached = this.blobCache.get(this.rgKey(rg.index))
            if (cached) {
              const offsetStart = start - rg.startByte
              const offsetEnd = actualEnd - rg.startByte
              return cached.slice(offsetStart, offsetEnd)
            }
          }
        }

        // 3. Try to coalesce from multiple cached sources
        const result = new Uint8Array(length)
        let pos = start
        let resultOffset = 0
        let allFromCache = true

        while (pos < actualEnd) {
          let found = false

          // Check tail cache
          if (this.tailCache && pos >= this.tailCacheStart) {
            const tailEnd = this.tailCacheStart + this.tailCache.byteLength
            if (pos < tailEnd) {
              const copyEnd = Math.min(actualEnd, tailEnd)
              const copyLen = copyEnd - pos
              const srcOffset = pos - this.tailCacheStart
              result.set(new Uint8Array(this.tailCache, srcOffset, copyLen), resultOffset)
              resultOffset += copyLen
              pos = copyEnd
              found = true
              continue
            }
          }

          // Check blob cache for each RG
          for (const rg of this.rowGroupInfos) {
            const cached = this.blobCache.get(this.rgKey(rg.index))
            if (!cached) continue

            if (pos >= rg.startByte && pos < rg.endByte) {
              const copyEnd = Math.min(actualEnd, rg.endByte)
              const copyLen = copyEnd - pos
              const srcOffset = pos - rg.startByte
              result.set(new Uint8Array(cached, srcOffset, copyLen), resultOffset)
              resultOffset += copyLen
              pos = copyEnd
              found = true
              break
            }
          }

          if (!found) {
            // Gap in cache - need to fetch from network
            allFromCache = false
            break
          }
        }

        if (allFromCache && resultOffset === length) {
          return result.buffer
        }

        // 4. Fallback: fetch entire range from network
        console.warn(`ParquetCache: uncached fetch for bytes ${start}-${actualEnd} (had ${resultOffset}/${length} cached)`)
        const res = await this.fetchFn(this.url, {
          headers: { Range: `bytes=${start}-${actualEnd - 1}` },
        })
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
        return res.arrayBuffer()
      },
    }
  }

  private indexRowGroups(): void {
    if (!this.metadata) return

    this.rowGroupInfos = []

    for (let i = 0; i < this.metadata.row_groups.length; i++) {
      const rg = this.metadata.row_groups[i]

      // Calculate byte range for this RG (all columns, contiguous)
      const colOffsets = rg.columns.map((col: ColumnChunk) => {
        const offset = Number(col.meta_data?.dictionary_page_offset ?? col.meta_data?.data_page_offset ?? 0)
        const size = Number(col.meta_data?.total_compressed_size ?? 0)
        return { start: offset, end: offset + size }
      })

      const startByte = Math.min(...colOffsets.map((c: { start: number; end: number }) => c.start))
      const endByte = Math.max(...colOffsets.map((c: { start: number; end: number }) => c.end))

      // Get timestamp stats from first column (assuming it's timestamp)
      const tsStats = rg.columns[0]?.meta_data?.statistics
      const minTimestamp = tsStats?.min_value ? new Date(tsStats.min_value as string) : undefined
      const maxTimestamp = tsStats?.max_value ? new Date(tsStats.max_value as string) : undefined

      this.rowGroupInfos.push({
        index: i,
        startByte,
        endByte,
        numRows: Number(rg.num_rows),
        minTimestamp,
        maxTimestamp,
      })
    }
  }

  /**
   * Move fully-cached immutable RGs from tail cache to blob cache.
   * Only promotes RGs before the last one (last RG may still grow).
   */
  private promoteCompletedRowGroups(): void {
    if (!this.tailCache || this.rowGroupInfos.length === 0) return

    // Don't promote the last RG - it may still be growing
    const immutableRGs = this.rowGroupInfos.slice(0, -1)

    for (const rg of immutableRGs) {
      // Skip if already in blob cache
      if (this.blobCache.has(this.rgKey(rg.index))) continue

      // Check if fully in tail cache
      if (this.isInTailCache(rg.startByte, rg.endByte)) {
        const offsetStart = rg.startByte - this.tailCacheStart
        const offsetEnd = rg.endByte - this.tailCacheStart
        const rgData = this.tailCache.slice(offsetStart, offsetEnd)
        this.blobCache.set(this.rgKey(rg.index), rgData)
      }
    }
  }
}
