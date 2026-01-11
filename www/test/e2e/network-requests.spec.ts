import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface ParquetRequest {
  url: string
  method: string
  range?: string
  deviceId: number | null
}

/**
 * Tests for verifying network request behavior during navigation.
 *
 * Key behaviors to test:
 * - User navigation should NOT trigger refresh (HEAD) requests
 * - Navigating within cached RGs should NOT fetch new data
 * - Navigating beyond cached RGs should fetch the needed historical RGs
 * - Forward navigation (toward Latest) should never fetch (data already cached)
 *
 * Test data RG structure (awair-17617.parquet):
 * - ~25 RGs, each covering ~7 days (~10,200 rows)
 * - Last RG is cached on initial load (128KB suffix fetch)
 */
test.describe('Network Request Behavior', () => {
  let parquetRequests: ParquetRequest[] = []

  // Helper to extract device ID from URL (format: awair-17617/2025-11.parquet)
  const getDeviceId = (url: string): number | null => {
    const match = url.match(/awair-(\d+)\//)
    return match ? parseInt(match[1]) : null
  }

  // Helper to clear and start fresh request tracking
  const clearRequests = () => {
    parquetRequests = []
  }

  // Helper to get requests since last clear, optionally filtered by device
  const getRequests = (deviceId?: number) => {
    if (deviceId === undefined) return parquetRequests
    return parquetRequests.filter(r => r.deviceId === deviceId)
  }

  // Helper to wait for network to settle after an action
  const waitForNetworkSettle = async (page: Page) => {
    // Wait a bit for any async operations to start, then wait for network idle
    await page.waitForTimeout(100)
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 })
    } catch {
      // Network idle timeout is OK - may already be idle
    }
  }

  test.beforeEach(async ({ page }) => {
    // Reset request tracking
    clearRequests()

    // Track all parquet requests
    page.on('request', request => {
      const url = request.url()
      if (url.includes('.parquet')) {
        parquetRequests.push({
          url,
          method: request.method(),
          range: request.headers()['range'],
          deviceId: getDeviceId(url),
        })
      }
    })

    // Log for debugging
    page.on('console', msg => {
      if (msg.text().includes('📥') || msg.text().includes('🔄')) {
        console.log('Browser:', msg.text())
      }
    })

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

      if (filePath && fs.existsSync(filePath)) {
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
  })

  test.describe('Single device (Gym) - 3d viewport', () => {
    test.beforeEach(async ({ page }) => {
      // Navigate with 3d duration, Gym device only, fixed endpoint
      // 3d = 4320 minutes, RGs are ~7d (~10080 min), so first `<` stays in last RG
      await page.goto('/?y=th&d=gym&w=3d&t=251129T1740')
      await page.waitForSelector('.data-table', { timeout: 30000 })

      // Wait for initial load to complete
      await waitForNetworkSettle(page)
    })

    test('initial load fetches parquet data', async () => {
      const gymRequests = getRequests(17617)

      // Should have initial requests: HEAD + Range request for tail (128KB)
      expect(gymRequests.length).toBeGreaterThan(0)

      // Should have at least one Range request
      const rangeRequests = gymRequests.filter(r => r.range)
      expect(rangeRequests.length).toBeGreaterThan(0)
    })

    test('table page back (,) does not fetch - stays within cached RG', async ({ page }) => {
      // Clear requests after initial load
      clearRequests()

      // Press , (table page back = 20 rows = 20 minutes)
      await page.keyboard.press(',')
      await waitForNetworkSettle(page)

      // Should have NO new parquet requests (20 min << 7 day RG)
      const gymRequests = getRequests(17617)
      expect(gymRequests).toHaveLength(0)

      // Verify table updated (indices should change)
      const tableText = await page.locator('.pagination .page-info').textContent()
      expect(tableText).toMatch(/^21-40/)
    })

    test('plot page back (<) first time does not fetch - stays within last RG', async ({ page }) => {
      clearRequests()

      // Type < for plot page back = 3d = 4320 minutes
      // Last RG (24) covers Nov 24-29 (~5d), so 3d back should still be in RG 24
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // Should have NO Range requests for data (maybe HEAD for refresh, but we disabled that)
      const dataRequests = gymRequests.filter(r => r.range)
      expect(dataRequests).toHaveLength(0)
    })

    test('multiple plot backs (<) eventually cross RG boundary and fetch', async ({ page }) => {
      // RG 24 covers Nov 24-29 (~5 days), starting at Nov 29
      // Each < navigates back ~1 day (1440 windows = 24h)
      // The visible 1-day window eventually spans both RG 23 and RG 24

      // Press < multiple times - boundary crossing happens when window spans RGs
      // Track when we see the first RG 23 fetch
      let sawRg23Fetch = false

      for (let i = 0; i < 6; i++) {
        const beforeCount = getRequests(17617).filter(r => r.range?.includes('3679435')).length
        await page.keyboard.type('<')
        await waitForNetworkSettle(page)
        const afterCount = getRequests(17617).filter(r => r.range?.includes('3679435')).length

        if (afterCount > beforeCount) {
          sawRg23Fetch = true
          console.log(`RG 23 fetch triggered on < press ${i + 1}`)
          break
        }
      }

      // Should have fetched RG 23 at some point
      expect(sawRg23Fetch).toBe(true)
    })

    test('plot back after crossing RG uses cached data', async ({ page }) => {
      // Go back 5 times to cross into RG 23 (fetches RG 23)
      for (let i = 0; i < 5; i++) {
        await page.keyboard.type('<')
        await waitForNetworkSettle(page)
      }

      clearRequests()

      // 6th < should use already-cached RG 23 (covers ~7 days)
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // Should have NO Range requests - RG 23 is already cached
      const dataRequests = gymRequests.filter(r => r.range)
      expect(dataRequests).toHaveLength(0)
    })

    test('forward navigation (>) after backward does not fetch', async ({ page }) => {
      // Go back twice to have history to return to
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      clearRequests()

      // Go forward (toward Latest)
      await page.keyboard.type('>')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // Should have NO fetches - data was already cached from going back
      expect(gymRequests).toHaveLength(0)
    })

    test('jump to Latest (M-.) after backward does not fetch', async ({ page }) => {
      // Go back
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      clearRequests()

      // Jump to Latest (Alt+. or Meta+.)
      await page.keyboard.press('Alt+.')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // Should have NO fetches - Latest data was already cached
      expect(gymRequests).toHaveLength(0)
    })

    test('table page forward (.) after backward does not fetch', async ({ page }) => {
      // Go back by table page
      await page.keyboard.press(',')
      await waitForNetworkSettle(page)

      clearRequests()

      // Go forward by table page
      await page.keyboard.press('.')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // Should have NO fetches
      expect(gymRequests).toHaveLength(0)
    })
  })

  test.describe('No HEAD requests on navigation', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/?y=th&d=gym&w=3d&t=251129T1740')
      await page.waitForSelector('.data-table', { timeout: 30000 })
      await waitForNetworkSettle(page)
    })

    test('backward navigation does not trigger HEAD (refresh) requests', async ({ page }) => {
      clearRequests()

      // Multiple backward navigations
      await page.keyboard.type(',')
      await waitForNetworkSettle(page)
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      const headRequests = gymRequests.filter(r => r.method === 'HEAD')

      // Should have NO HEAD requests - refresh is only for smart polling
      expect(headRequests).toHaveLength(0)
    })

    test('forward navigation does not trigger unnecessary data fetches', async ({ page }) => {
      // First go back
      await page.keyboard.type('<')
      await waitForNetworkSettle(page)

      clearRequests()

      // Then forward
      await page.keyboard.type('>')
      await waitForNetworkSettle(page)
      await page.keyboard.type('.')
      await waitForNetworkSettle(page)

      const gymRequests = getRequests(17617)
      // With monthly sharding, HEAD requests to discover new monthly files are expected.
      // We only check that no new Range (data) requests are made to already-cached data.
      const dataRequests = gymRequests.filter(r => r.range && r.url.includes('2025-11'))

      expect(dataRequests).toHaveLength(0)
    })
  })
})
