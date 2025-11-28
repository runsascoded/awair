#!/usr/bin/env node
/**
 * Capture HAR files for Awair dashboard network analysis.
 *
 * Usage:
 *   node test/capture-har.mjs [options]
 *
 * Options:
 *   --url, -u       Base URL (default: http://localhost:5173)
 *   --duration, -d  Time range duration label (default: 1d)
 *   --polls, -p     Number of poll cycles to wait for (default: 0)
 *   --ri            Refetch interval in ms (default: 5000 for testing)
 *   --output, -o    Output HAR file path (default: tmp/awair-{duration}.har)
 *   --analyze       Print analysis of captured requests
 *
 * Examples:
 *   # Capture initial load for 1 day view
 *   node test/capture-har.mjs -d 1d
 *
 *   # Capture initial load + 2 poll cycles
 *   node test/capture-har.mjs -d 1d -p 2 --ri 3000
 *
 *   # Test against production
 *   node test/capture-har.mjs -u https://awair.runsascoded.com -d 7d
 */

import puppeteer from 'puppeteer'
import PuppeteerHar from 'puppeteer-har'
import fs from 'fs'
import path from 'path'

// Parse command line arguments
const args = process.argv.slice(2)
const options = {
  url: 'http://localhost:5173',
  duration: '1d',
  polls: 0,
  ri: 5000,
  output: null,
  analyze: false,
}

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  const next = args[i + 1]

  switch (arg) {
    case '--url':
    case '-u':
      options.url = next
      i++
      break
    case '--duration':
    case '-d':
      options.duration = next
      i++
      break
    case '--polls':
    case '-p':
      options.polls = parseInt(next, 10)
      i++
      break
    case '--ri':
      options.ri = parseInt(next, 10)
      i++
      break
    case '--output':
    case '-o':
      options.output = next
      i++
      break
    case '--analyze':
      options.analyze = true
      break
    case '--help':
    case '-h':
      console.log(`
Usage: node test/capture-har.mjs [options]

Options:
  --url, -u       Base URL (default: http://localhost:5173)
  --duration, -d  Time range duration label (default: 1d)
  --polls, -p     Number of poll cycles to wait for (default: 0)
  --ri            Refetch interval in ms (default: 5000 for testing)
  --output, -o    Output HAR file path (default: tmp/awair-{duration}.har)
  --analyze       Print analysis of captured requests
`)
      process.exit(0)
  }
}

// Build URL with params
const pageUrl = new URL(options.url)
pageUrl.searchParams.set('t', `-${options.duration}`)  // Relative time range
pageUrl.searchParams.set('d', '17617 137496')  // Both devices by numeric ID
if (options.polls > 0) {
  pageUrl.searchParams.set('ri', String(options.ri))  // Fast polling for tests
}

const outputPath = options.output || `tmp/awair-${options.duration}${options.polls > 0 ? `-p${options.polls}` : ''}.har`

console.log(`\n=== HAR Capture ===`)
console.log(`URL: ${pageUrl}`)
console.log(`Polls: ${options.polls} (interval: ${options.ri}ms)`)
console.log(`Output: ${outputPath}`)

async function main() {
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()

  // Capture console logs
  page.on('console', msg => {
    const text = msg.text()
    // Filter to parquet-related logs
    if (text.includes('parquet') || text.includes('RG') || text.includes('📦') || text.includes('📤') || text.includes('🔧') || text.includes('🆕') || text.includes('🔄')) {
      console.log(`[console] ${text}`)
    }
  })

  // Track network requests for analysis
  const requests = []
  let requestId = 0
  page.on('request', request => {
    if (request.url().includes('.parquet')) {
      requests.push({
        id: ++requestId,
        url: request.url(),
        method: request.method(),
        headers: request.headers(),
        timestamp: Date.now(),
      })
    }
  })

  page.on('response', async response => {
    if (response.url().includes('.parquet')) {
      // Find the matching request (same URL + method, not yet completed)
      const req = requests.find(r =>
        r.url === response.url() &&
        r.method === response.request().method() &&
        !r.status
      )
      if (req) {
        req.status = response.status()
        req.contentLength = parseInt(response.headers()['content-length'] || '0', 10)
        req.contentRange = response.headers()['content-range']
        req.responseTime = Date.now() - req.timestamp
      }
    }
  })

  // Start HAR recording
  const har = new PuppeteerHar(page)
  await har.start({ path: outputPath })

  console.log(`\nNavigating to ${pageUrl}...`)
  const startTime = Date.now()

  await page.goto(pageUrl.toString(), { waitUntil: 'networkidle0' })

  // Wait for chart to be ready
  try {
    await page.waitForFunction('window.chartReady === true', { timeout: 30000 })
    console.log(`Chart ready in ${Date.now() - startTime}ms`)
  } catch {
    console.log(`Chart readiness check timed out (may not be implemented)`)
  }

  // Wait for poll cycles if requested
  if (options.polls > 0) {
    console.log(`\nWaiting for ${options.polls} poll cycles...`)
    const pollWaitTime = options.ri * options.polls + 2000  // Extra 2s buffer
    await new Promise(resolve => setTimeout(resolve, pollWaitTime))
    console.log(`Polling complete`)
  }

  await har.stop()
  await browser.close()

  const totalTime = Date.now() - startTime
  console.log(`\nCapture complete in ${totalTime}ms`)
  console.log(`HAR saved to: ${outputPath}`)

  // Analyze captured requests
  if (options.analyze || requests.length > 0) {
    console.log(`\n=== Parquet Requests ===`)
    const parquetRequests = requests.filter(r => r.url.includes('.parquet'))

    let totalBytes = 0
    const firstTime = parquetRequests[0]?.timestamp || 0
    for (const req of parquetRequests) {
      const filename = req.url.split('/').pop()
      const bytes = req.contentLength || 0
      totalBytes += bytes
      const rangeHeader = req.headers.range || '(full)'
      const relTime = req.timestamp - firstTime

      console.log(`\n${req.method} ${filename} @ +${relTime}ms`)
      console.log(`  Range: ${rangeHeader}`)
      console.log(`  Status: ${req.status}, ${(bytes / 1024).toFixed(1)}KB, ${req.responseTime}ms`)
      if (req.contentRange) {
        console.log(`  Content-Range: ${req.contentRange}`)
      }
    }

    console.log(`\n=== Summary ===`)
    console.log(`Total parquet requests: ${parquetRequests.length}`)
    console.log(`Total bytes transferred: ${(totalBytes / 1024).toFixed(1)}KB`)

    // Group by file
    const byFile = {}
    for (const req of parquetRequests) {
      const filename = req.url.split('/').pop()
      if (!byFile[filename]) byFile[filename] = []
      byFile[filename].push(req)
    }

    console.log(`\nBy file:`)
    for (const [filename, reqs] of Object.entries(byFile)) {
      const gets = reqs.filter(r => r.method === 'GET')
      const heads = reqs.filter(r => r.method === 'HEAD')
      const bytes = gets.reduce((sum, r) => sum + (r.contentLength || 0), 0)
      console.log(`  ${filename}: ${gets.length} GETs (${(bytes / 1024).toFixed(1)}KB) + ${heads.length} HEADs`)
    }
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
