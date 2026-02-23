import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('Hotkey Editing', () => {
  test.beforeEach(async ({ page }) => {
    // Log console messages for debugging
    page.on('console', msg => console.log('Browser console:', msg.text()))
    page.on('pageerror', error => console.error('Page error:', error))

    // Clear localStorage before each test to start with default hotkeys
    await page.addInitScript(() => {
      localStorage.removeItem('awair-hotkeys')
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

  test('can open shortcuts modal with ? key', async ({ page }) => {
    // Click on body to focus the page (avoid clicking on plotly chart which captures events)
    await page.locator('body').click({ position: { x: 10, y: 10 } })

    // Press ? to open shortcuts modal
    await page.keyboard.press('?')

    // Wait for modal to appear
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    // Verify modal is open
    const modal = page.locator('.kbd-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('h2')).toHaveText('Keyboard Shortcuts')
  })

  test('shortcuts modal has opaque background in light mode', async ({ page }) => {
    // Open shortcuts modal (default is light mode)
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    const modal = page.locator('.kbd-modal')

    // Get computed background color
    const bgColor = await modal.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor
    })

    // Background should be opaque (not transparent)
    const rgbaMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
    expect(rgbaMatch).not.toBeNull()
    const alpha = rgbaMatch![4] !== undefined ? parseFloat(rgbaMatch![4]) : 1
    expect(alpha).toBe(1)
  })

  test('shortcuts modal has opaque background in dark mode', async ({ page }) => {
    // Set dark mode before navigating (awair uses 'awair-theme' key)
    await page.addInitScript(() => {
      localStorage.setItem('awair-theme', 'dark')
    })

    // Re-navigate to apply theme
    await page.goto('/?y=th&d=gym&t=251129T1740')
    await page.waitForSelector('.js-plotly-plot', { timeout: 30000 })

    // Verify dark mode is active
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    expect(dataTheme).toBe('dark')

    // Open shortcuts modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    const modal = page.locator('.kbd-modal')

    // Get computed background color
    const bgColor = await modal.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor
    })

    // Background should be opaque (not transparent)
    const rgbaMatch = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
    expect(rgbaMatch).not.toBeNull()
    const alpha = rgbaMatch![4] !== undefined ? parseFloat(rgbaMatch![4]) : 1
    expect(alpha).toBe(1)

    // In dark mode, should be dark color (low RGB values), not white fallback
    const r = parseInt(rgbaMatch![1])
    const g = parseInt(rgbaMatch![2])
    const b = parseInt(rgbaMatch![3])

    // Dark mode background should be dark (sum of RGB < 200 typically)
    // #1a1a1a = rgb(26, 26, 26) = 78
    expect(r + g + b).toBeLessThan(200)
  })

  test('can edit a hotkey by clicking and pressing a new key', async ({ page }) => {
    // Click to focus, then open shortcuts modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    // Find the Temperature row in the Left column and click its kbd element
    // The table structure is: Metric | Left | Right
    // Temperature is the first row
    // Each cell can have multiple kbd elements (multiple bindings), so use first()
    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd').first()

    // Verify it starts with 'T' (text includes × remove button)
    await expect(leftKbd).toContainText('T')

    // Click to start editing
    await leftKbd.click()

    // Verify it's in editing mode (shows "...")
    await expect(leftKbd).toHaveClass(/editing/)

    // Press a new key - use 'q' (not already bound in DEFAULT_HOTKEY_MAP)
    await page.keyboard.press('q')

    // Press Enter to confirm the key (sequenceTimeout is Infinity, so no auto-exit)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // Verify the key was replaced (T -> Q)
    const leftCell = tempRow.locator('td:nth-child(2)')
    await expect(leftCell.locator('kbd', { hasText: 'Q' })).toBeVisible()
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toHaveCount(0)  // T should be gone
    await expect(leftCell.locator('kbd.editing')).toHaveCount(0)
  })

  test('edited hotkey persists and works', async ({ page }) => {
    // Click to focus the page
    await page.locator('body').click({ position: { x: 10, y: 10 } })

    // First verify that 't' switches to temperature (default)
    // The y-axis should show temp by default based on URL
    const yAxisDropdown = page.locator('.legend-metric-control select').first()
    await expect(yAxisDropdown).toHaveValue('temp')

    // Change to CO2 first
    await page.keyboard.press('c')
    await page.waitForTimeout(300)
    await expect(yAxisDropdown).toHaveValue('co2')

    // Now open modal and change temp hotkey to 'q' (not already bound)
    // Note: 'x' is already bound to 'time:all' in DEFAULT_HOTKEY_MAP, so it would conflict
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd').first()

    await leftKbd.click()
    await page.keyboard.press('q')
    await page.keyboard.press('Enter')  // Confirm the key (sequenceTimeout is Infinity)
    await page.waitForTimeout(300)

    // Verify the key was replaced (T -> Q)
    const leftCell = tempRow.locator('td:nth-child(2)')
    await expect(leftCell.locator('kbd', { hasText: 'Q' })).toBeVisible()
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toHaveCount(0)  // T should be gone

    // Close modal by pressing Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Verify modal is closed
    await expect(page.locator('.kbd-modal')).not.toBeVisible()

    // Click body to ensure focus is on page, not leftover from modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.waitForTimeout(100)

    // Now press 'q' - should switch to temperature
    await page.keyboard.press('q')
    await page.waitForTimeout(300)

    // Verify it switched to temp
    await expect(yAxisDropdown).toHaveValue('temp')

    // Verify old 't' key no longer works (should stay on temp, not change anything)
    // Actually 't' is now unbound, so pressing it should do nothing
    await page.keyboard.press('c')  // Switch to CO2 first
    await page.waitForTimeout(300)
    await expect(yAxisDropdown).toHaveValue('co2')

    await page.keyboard.press('t')  // Old key - should do nothing
    await page.waitForTimeout(300)
    await expect(yAxisDropdown).toHaveValue('co2')  // Should still be CO2
  })

  test('can edit hotkey to a number', async ({ page }) => {
    // Click to focus, then open shortcuts modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    // Find Temperature row and click left kbd
    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd').first()

    await expect(leftKbd).toContainText('T')

    // Click and press '9'
    await leftKbd.click()
    await page.keyboard.press('9')
    await page.keyboard.press('Enter')  // Confirm the key (sequenceTimeout is Infinity)
    await page.waitForTimeout(300)

    // Verify update (text includes × remove button)
    await expect(leftKbd).toContainText('9')

    // Close modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // First switch to CO2
    await page.keyboard.press('c')
    await page.waitForTimeout(300)

    const yAxisDropdown = page.locator('.legend-metric-control select').first()
    await expect(yAxisDropdown).toHaveValue('co2')

    // Now press '9' - shows completion modal because '9' is prefix for '9 d', '9 h', etc.
    // Press Enter to select the first option (Temperature)
    await page.keyboard.press('9')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await expect(yAxisDropdown).toHaveValue('temp')
  })

  test('assigning key that conflicts shows warning and disables both', async ({ page }) => {
    // Click to focus, open modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    // Change temp hotkey to 'f' which is already bound to 'time:09-all' (Full history) in defaults
    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd').first()

    // Verify initial state: temp is 'T'
    await expect(leftKbd).toContainText('T')

    // Find Full history action in Time Range section
    // Time Range uses default layout (.kbd-action), not table layout
    const timeRangeGroup = page.locator('.kbd-group:has(h3:has-text("Time Range"))')
    const fullHistoryAction = timeRangeGroup.locator('.kbd-action', { hasText: 'Full history' })
    const fullHistoryKbd = fullHistoryAction.locator('kbd')

    // Verify initial state: Full history is 'F'
    await expect(fullHistoryKbd).toContainText('F')

    // Now assign 'f' to Temperature
    await leftKbd.click()

    // Wait for editing mode before pressing key (prevents race with hotkey handler)
    await expect(leftKbd).toHaveClass(/editing/)

    await page.keyboard.press('f')

    // use-kbd pauses timeout when conflict detected during recording,
    // so we need to press Enter to explicitly commit and trigger warning
    await page.waitForTimeout(200) // Brief wait for conflict detection
    await page.keyboard.press('Enter')

    // use-kbd shows conflict warning banner after explicit commit
    const warningBanner = page.locator('.kbd-conflict-warning')
    await expect(warningBanner).toBeVisible()
    await expect(warningBanner).toContainText('already bound to')

    // Click Override to commit the conflicting binding
    await warningBanner.locator('button', { hasText: 'Override' }).click()
    await page.waitForTimeout(300)

    // Verify Temperature now shows 'F' (committed)
    await expect(leftKbd).toContainText('F')
    await expect(leftKbd).toHaveClass(/conflict/)

    // CRITICAL: Verify Full history ALSO shows 'F' (same key, because both are bound to 'f')
    await expect(fullHistoryKbd).toContainText('F')
    await expect(fullHistoryKbd).toHaveClass(/conflict/)

    // Close modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Click body to focus
    await page.locator('body').click({ position: { x: 10, y: 10 } })

    // Verify the y-axis is still on temp (initial value)
    const yAxisDropdown = page.locator('.legend-metric-control select').first()
    await expect(yAxisDropdown).toHaveValue('temp')

    // Press 'f' - should NOT switch because it's disabled due to conflict
    await page.keyboard.press('f')
    await page.waitForTimeout(300)

    // Should still be temp (f is disabled)
    await expect(yAxisDropdown).toHaveValue('temp')
  })

  test('adding multiple keys to an action using + button', async ({ page }) => {
    // Multi-binding: use + button to add additional bindings to an action
    // Clicking existing key edits/replaces it, + button adds new ones

    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftCell = tempRow.locator('td:nth-child(2)')

    // Initially should have just 'T'
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toBeVisible()

    // Add 'q' using the + button (adds, doesn't replace)
    const addButton = leftCell.locator('.kbd-add-btn')
    await addButton.click()
    await page.keyboard.press('q')
    await page.keyboard.press('Enter')  // Confirm the key (sequenceTimeout is Infinity)
    await page.waitForTimeout(300)

    // Now should have both T and Q
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toBeVisible()
    await expect(leftCell.locator('kbd', { hasText: 'Q' })).toBeVisible()

    // Add 'y' as well using the + button
    await addButton.click()
    await page.keyboard.press('y')
    await page.keyboard.press('Enter')  // Confirm the key (sequenceTimeout is Infinity)
    await page.waitForTimeout(300)

    // Should have T, Q, and Y
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toBeVisible()
    await expect(leftCell.locator('kbd', { hasText: 'Q' })).toBeVisible()
    await expect(leftCell.locator('kbd', { hasText: 'Y' })).toBeVisible()

    // Check localStorage - should have custom bindings for q and y
    // use-kbd stores overrides under 'use-kbd' key by default
    const storage = await page.evaluate(() => localStorage.getItem('use-kbd'))
    const overrides = JSON.parse(storage || '{}')

    expect(overrides['q']).toBe('left:temp')
    expect(overrides['y']).toBe('left:temp')
  })

  test('reset button restores default hotkeys', async ({ page }) => {
    // Click to focus, then open modal and add 'z' to temp using + button
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.kbd-modal', { timeout: 5000 })

    const tempRow = page.locator('.kbd-table tbody tr').first()
    const leftCell = tempRow.locator('td:nth-child(2)')

    // Add 'z' binding using + button (adds, doesn't replace)
    const addButton = leftCell.locator('.kbd-add-btn')
    await addButton.click()
    await page.keyboard.press('z')
    await page.keyboard.press('Enter')  // Confirm the key (sequenceTimeout is Infinity)
    await page.waitForTimeout(300)
    await expect(leftCell.locator('kbd', { hasText: 'Z' })).toBeVisible()

    // Verify we now have both T and Z
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toBeVisible()

    // Click Reset button (in footer)
    await page.locator('.kbd-modal button:has-text("Reset")').click()
    await page.waitForTimeout(300)

    // Verify Z is gone and only T remains
    await expect(leftCell.locator('kbd', { hasText: 'Z' })).toHaveCount(0)
    await expect(leftCell.locator('kbd', { hasText: 'T' })).toBeVisible()
  })
})
