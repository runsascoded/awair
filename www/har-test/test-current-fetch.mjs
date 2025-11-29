#!/usr/bin/env node
/**
 * Test current fetch behavior with the linked hyparquet.
 * Shows what gets fetched on initialize() and refresh().
 */

import { asyncBufferFromUrl, parquetMetadataAsync } from 'hyparquet'

const url = 'https://380nwk.s3.amazonaws.com/awair-17617.parquet'

// Track fetch calls
const fetchCalls = []
const originalFetch = globalThis.fetch
globalThis.fetch = function(url, options) {
  const range = options?.headers?.Range || options?.headers?.range || 'no range'
  fetchCalls.push({ url: url.toString().split('/').pop(), method: options?.method || 'GET', range })
  return originalFetch.apply(this, arguments)
}

console.log('=== Testing current fetch behavior ===\n')

// Test 1: Get file metadata
console.log('[1] Creating async buffer and fetching metadata...')
const file = await asyncBufferFromUrl({ url })
const metadata = await parquetMetadataAsync(file, { initialFetchSize: 128 * 1024 })

console.log(`✅ File size: ${(file.byteLength / 1024).toFixed(0)}KB`)
console.log(`✅ Metadata size: ${(metadata.metadata_length / 1024).toFixed(1)}KB`)
console.log(`✅ Row groups: ${metadata.row_groups.length}`)
console.log(`✅ Total rows: ${metadata.num_rows}`)

// Analyze last RG
const lastRG = metadata.row_groups[metadata.row_groups.length - 1]
const lastRGCols = lastRG.columns.map(c => {
  const offset = Number(c.meta_data.dictionary_page_offset ?? c.meta_data.data_page_offset ?? 0)
  const size = Number(c.meta_data.total_compressed_size ?? 0)
  return { start: offset, end: offset + size }
})
const lastRGStart = Math.min(...lastRGCols.map(c => c.start))
const lastRGEnd = Math.max(...lastRGCols.map(c => c.end))
const lastRGSize = lastRGEnd - lastRGStart

console.log(`\n=== Last Row Group (#${metadata.row_groups.length - 1}) ===`)
console.log(`Bytes: ${lastRGStart.toLocaleString()} - ${lastRGEnd.toLocaleString()}`)
console.log(`Size: ${(lastRGSize / 1024).toFixed(0)}KB`)
console.log(`Rows: ${lastRG.num_rows}`)

const footerStart = file.byteLength - metadata.metadata_length - 8
console.log(`\n=== Footer ===`)
console.log(`Starts at byte: ${footerStart.toLocaleString()}`)
console.log(`Size: ${(metadata.metadata_length / 1024).toFixed(1)}KB`)

console.log(`\n=== Fetch Analysis ===`)
console.log(`Total fetch calls: ${fetchCalls.length}`)

fetchCalls.forEach((f, i) => {
  console.log(`\n[${i + 1}] ${f.method} ${f.url}`)
  console.log(`    Range: ${f.range}`)

  if (f.range.startsWith('bytes=')) {
    const match = f.range.match(/bytes=(\d+)-(\d+)?/)
    if (match) {
      const start = parseInt(match[1])
      const end = match[2] ? parseInt(match[2]) : file.byteLength - 1
      const size = end - start + 1
      console.log(`    Fetched: ${(size / 1024).toFixed(0)}KB (bytes ${start.toLocaleString()}-${end.toLocaleString()})`)

      // Check what this fetch contains
      if (start <= lastRGStart && end >= lastRGEnd) {
        console.log(`    Contains: FULL last RG + footer`)
      } else if (start <= lastRGStart && end >= lastRGStart) {
        console.log(`    Contains: PARTIAL last RG + footer`)
      } else if (start > lastRGStart && end >= lastRGEnd) {
        console.log(`    Contains: part of last RG + footer`)
      }
    }
  }
})

console.log(`\n=== Refresh Calculation ===`)
const refreshStart = lastRGStart
const refreshEnd = file.byteLength - 1
const refreshSize = refreshEnd - refreshStart + 1
console.log(`If we refresh from last RG start to EOF:`)
console.log(`  Range: bytes=${refreshStart}-`)
console.log(`  Size: ${(refreshSize / 1024).toFixed(0)}KB`)
console.log(`  Contains: last RG (${(lastRGSize / 1024).toFixed(0)}KB) + footer (${(metadata.metadata_length / 1024).toFixed(1)}KB)`)
