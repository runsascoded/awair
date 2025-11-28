/**
 * Simple LRU (Least Recently Used) cache with size-based eviction.
 * Optimized for caching ArrayBuffers with a max total byte size.
 */

export interface LRUCacheOptions {
  /** Maximum total size in bytes (default: 10MB) */
  maxSize?: number
  /** Called when an item is evicted */
  onEvict?: (key: string, value: ArrayBuffer) => void
}

interface CacheEntry {
  key: string
  value: ArrayBuffer
  size: number
}

/**
 * LRU cache for ArrayBuffers with size-based eviction.
 *
 * Uses a Map for O(1) access and maintains insertion order for LRU.
 * When maxSize is exceeded, evicts least recently used entries.
 */
export class LRUCache {
  private cache: Map<string, CacheEntry> = new Map()
  private currentSize: number = 0
  private maxSize: number
  private onEvict?: (key: string, value: ArrayBuffer) => void

  constructor(options: LRUCacheOptions = {}) {
    this.maxSize = options.maxSize ?? 10 * 1024 * 1024 // 10MB default
    this.onEvict = options.onEvict
  }

  /**
   * Get a value from the cache.
   * Moves the entry to the end (most recently used).
   */
  get(key: string): ArrayBuffer | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    // Move to end (most recently used) by deleting and re-adding
    this.cache.delete(key)
    this.cache.set(key, entry)

    return entry.value
  }

  /**
   * Check if a key exists without updating LRU order.
   */
  has(key: string): boolean {
    return this.cache.has(key)
  }

  /**
   * Set a value in the cache.
   * Evicts LRU entries if maxSize would be exceeded.
   */
  set(key: string, value: ArrayBuffer): void {
    const size = value.byteLength

    // If this single item exceeds max size, don't cache it
    if (size > this.maxSize) {
      console.warn(`LRUCache: item ${key} (${(size / 1024).toFixed(0)}KB) exceeds maxSize, not caching`)
      return
    }

    // Remove existing entry if present
    if (this.cache.has(key)) {
      const existing = this.cache.get(key)!
      this.currentSize -= existing.size
      this.cache.delete(key)
    }

    // Evict LRU entries until we have room
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
      this.evictOldest()
    }

    // Add new entry
    const entry: CacheEntry = { key, value, size }
    this.cache.set(key, entry)
    this.currentSize += size
  }

  /**
   * Delete a specific key from the cache.
   */
  delete(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    this.cache.delete(key)
    this.currentSize -= entry.size
    return true
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear()
    this.currentSize = 0
  }

  /**
   * Get cache statistics.
   */
  stats(): { entries: number; size: number; maxSize: number; utilization: number } {
    return {
      entries: this.cache.size,
      size: this.currentSize,
      maxSize: this.maxSize,
      utilization: this.currentSize / this.maxSize,
    }
  }

  /**
   * Get all keys in LRU order (oldest first).
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  private evictOldest(): void {
    // Map maintains insertion order, so first key is oldest
    const oldestKey = this.cache.keys().next().value
    if (oldestKey === undefined) return

    const entry = this.cache.get(oldestKey)!
    this.cache.delete(oldestKey)
    this.currentSize -= entry.size

    if (this.onEvict) {
      this.onEvict(entry.key, entry.value)
    }
  }
}
