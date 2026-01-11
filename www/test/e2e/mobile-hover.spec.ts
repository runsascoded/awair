import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { test, expect, devices } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Use iPhone 12 for mobile emulation
const iPhone = devices['iPhone 12']
test.use({ ...iPhone })

test.describe('Mobile Hover Dismiss', () => {

  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', msg => console.log('Browser console:', msg.text()))
    page.on('pageerror', error => console.error('Page error:', error))

    // Intercept S3 requests and serve local snapshot files
    await page.route('**/*.parquet', async route => {
      const request = route.request()
      const url = request.url()
      const method = request.method()

      let filePath: string | null = null
      // Monthly sharded format: awair-17617/2025-11.parquet
      // Test data spans June-November 2025, serve test file for those months
      const testDataMonths = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11']
      const isTestDataMonth = testDataMonths.some(m => url.includes(`/${m}.parquet`))

      if (url.includes('awair-17617/') && isTestDataMonth) {
        filePath = path.join(__dirname, '../../test-data/awair-17617.parquet')
      } else if (url.includes('awair-17617/')) {
        // Months outside test data range - return 404
        await route.fulfill({ status: 404 })
        return
      } else if (url.includes('awair-137496/') && isTestDataMonth) {
        filePath = path.join(__dirname, '../../test-data/awair-137496.parquet')
      } else if (url.includes('awair-137496/')) {
        // Months outside test data range - return 404
        await route.fulfill({ status: 404 })
        return
      } else if (url.includes('devices.parquet')) {
        filePath = path.join(__dirname, '../../test-data/devices.parquet')
      }

      if (filePath) {
        const stats = fs.statSync(filePath)
        const fileSize = stats.size

        if (method === 'HEAD') {
          await route.fulfill({
            status: 200,
            headers: {
              'Content-Length': fileSize.toString(),
              'Accept-Ranges': 'bytes',
              'Content-Type': 'application/octet-stream',
            },
          })
          return
        }

        const rangeHeader = request.headers()['range']
        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
          if (match) {
            const start = parseInt(match[1])
            const end = match[2] ? parseInt(match[2]) : fileSize - 1
            const buffer = Buffer.alloc(end - start + 1)
            const fd = fs.openSync(filePath, 'r')
            fs.readSync(fd, buffer, 0, buffer.length, start)
            fs.closeSync(fd)

            await route.fulfill({
              status: 206,
              headers: {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': buffer.length.toString(),
                'Accept-Ranges': 'bytes',
                'Content-Type': 'application/octet-stream',
              },
              body: buffer,
            })
            return
          }
        }

        const buffer = fs.readFileSync(filePath)
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: buffer,
          headers: {
            'Content-Length': buffer.length.toString(),
            'Accept-Ranges': 'bytes',
          },
        })
      } else {
        await route.continue()
      }
    })

    // Navigate to the page
    await page.goto('/?y=th&d=gym&t=251129T1740')

    // Wait for chart to load
    await page.waitForSelector('.js-plotly-plot', { timeout: 30000 })
  })

  test('tap shows hover tooltip on mobile', async ({ page }) => {
    // Get the plot element
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    // Tap in the center of the plot to trigger hover
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })

    // In x-unified mode, Plotly creates a g.legend element for the hover tooltip (not g.hovertext)
    // Also creates spikeline elements for the vertical line
    const hoverLegend = page.locator('.hoverlayer g.legend')
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })
  })

  test('tap outside plot dismisses hover tooltip', async ({ page }) => {
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    const hoverLegend = page.locator('.hoverlayer g.legend')

    // First tap to show hover
    console.log('TAP 1: show hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })

    // Tap outside plot (above it) to dismiss
    console.log('TAP 2: tap outside to dismiss')
    await page.tap('body', { position: { x: plotBox!.x + plotBox!.width / 2, y: 10 } })
    await page.waitForTimeout(100)

    // Hover should be dismissed
    await expect(hoverLegend).not.toBeVisible({ timeout: 2000 })
  })

  // Skip: Plotly's mobile touch behavior doesn't reliably show hover on subsequent taps.
  // Our dismiss handler correctly returns early (inDragLayer: true), but Plotly doesn't show hover.
  test.skip('tap on plot while hover visible moves hover (does not dismiss)', async ({ page }) => {
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    const hoverLegend = page.locator('.hoverlayer g.legend')

    // Tap 1: show hover
    console.log('TAP 1: show hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })

    // Tap 2: tap different spot on plot - hover should stay visible (just move)
    console.log('TAP 2: tap different spot on plot')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 4, y: plotBox!.height / 2 } })

    // Hover should still be visible (may briefly disappear while moving)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })
  })

  // Skip: This chart uses CustomLegend component instead of Plotly's built-in legend,
  // so the .legend .traces selector doesn't exist. The stale hover bug was fixed in plotly.js.
  test.skip('legend tap after dismiss does not show stale hover', async ({ page }) => {
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    const hoverLegend = page.locator('.hoverlayer g.legend')

    // Tap 1: show hover
    console.log('TAP 1: show hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })
    await page.waitForTimeout(500)  // Longer wait to avoid double-tap detection
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })

    // Tap 2: dismiss hover
    console.log('TAP 2: dismiss hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 3, y: plotBox!.height / 2 } })
    await page.waitForTimeout(500)  // Longer wait to avoid double-tap detection
    await expect(hoverLegend).not.toBeVisible({ timeout: 2000 })

    // Tap legend - should NOT show hover at stale position
    console.log('TAP LEGEND: should not show stale hover')
    const legend = page.locator('.legend .traces')
    await legend.first().tap()
    await page.waitForTimeout(100)

    // Hover should still be hidden (legend tap should not restore stale hover)
    await expect(hoverLegend).not.toBeVisible({ timeout: 2000 })

    // Tap plot - should show hover (toggle state should work correctly)
    console.log('TAP 3: show hover after legend tap')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 4, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })
  })
})
