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
      if (url.includes('awair-17617.parquet')) {
        filePath = path.join(__dirname, '../../test-data/awair-17617.parquet')
      } else if (url.includes('awair-137496.parquet')) {
        filePath = path.join(__dirname, '../../test-data/awair-137496.parquet')
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

  test('second tap dismisses hover tooltip on mobile', async ({ page }) => {
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    const hoverLegend = page.locator('.hoverlayer g.legend')

    // First tap to show hover
    console.log('TAP 1: show hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)

    // Hover should be visible after first tap
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })

    // Second tap to dismiss
    console.log('TAP 2: dismiss hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 3, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)

    // Hover should be dismissed
    await expect(hoverLegend).not.toBeVisible({ timeout: 2000 })
  })

  test('third tap shows hover again after dismiss', async ({ page }) => {
    const plot = page.locator('.js-plotly-plot')
    const plotBox = await plot.boundingBox()
    expect(plotBox).not.toBeNull()

    const hoverLegend = page.locator('.hoverlayer g.legend')

    // Tap 1: show hover
    console.log('TAP 1: show hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 2, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })

    // Tap 2: dismiss hover
    console.log('TAP 2: dismiss hover')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 3, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).not.toBeVisible({ timeout: 2000 })

    // Tap 3: show hover again
    console.log('TAP 3: show hover again')
    await page.tap('.js-plotly-plot', { position: { x: plotBox!.width / 4, y: plotBox!.height / 2 } })
    await page.waitForTimeout(100)
    await expect(hoverLegend).toBeVisible({ timeout: 5000 })
  })
})
