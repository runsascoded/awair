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

  test('can open shortcuts modal with ? key', async ({ page }) => {
    // Click on body to focus the page (avoid clicking on plotly chart which captures events)
    await page.locator('body').click({ position: { x: 10, y: 10 } })

    // Press ? to open shortcuts modal
    await page.keyboard.press('?')

    // Wait for modal to appear
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    // Verify modal is open
    const modal = page.locator('.shortcuts-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('h2')).toHaveText('Keyboard Shortcuts')
  })

  test('can edit a hotkey by clicking and pressing a new key', async ({ page }) => {
    // Click to focus, then open shortcuts modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    // Find the Temperature row in the Left column and click its kbd element
    // The table structure is: Metric | Left | Right
    // Temperature is the first row
    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    // Verify it starts with 'T'
    await expect(leftKbd).toHaveText('T')

    // Click to start editing
    await leftKbd.click()

    // Verify it's in editing mode (shows "...")
    await expect(leftKbd).toHaveClass(/editing/)

    // Press a new key - use 'q' (not already bound in DEFAULT_HOTKEY_MAP)
    await page.keyboard.press('q')

    // Wait for the update
    await page.waitForTimeout(500)

    // Verify the new key is displayed
    await expect(leftKbd).toHaveText('Q')
    await expect(leftKbd).not.toHaveClass(/editing/)
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
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    await leftKbd.click()
    await page.keyboard.press('q')
    await page.waitForTimeout(500)

    // Verify the key was updated in the modal
    await expect(leftKbd).toHaveText('Q')

    // Close modal by pressing Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Verify modal is closed
    await expect(page.locator('.shortcuts-modal')).not.toBeVisible()

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
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    // Find Temperature row and click left kbd
    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    await expect(leftKbd).toHaveText('T')

    // Click and press '9'
    await leftKbd.click()
    await page.keyboard.press('9')
    await page.waitForTimeout(500)

    // Verify update
    await expect(leftKbd).toHaveText('9')

    // Close modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // First switch to CO2
    await page.keyboard.press('c')
    await page.waitForTimeout(300)

    const yAxisDropdown = page.locator('.legend-metric-control select').first()
    await expect(yAxisDropdown).toHaveValue('co2')

    // Now press '9' - should switch to temperature
    await page.keyboard.press('9')
    await page.waitForTimeout(300)
    await expect(yAxisDropdown).toHaveValue('temp')
  })

  test('assigning key that conflicts shows warning and disables both', async ({ page }) => {
    // Click to focus, open modal
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    // Change temp hotkey to 'x' which is already bound to 'time:06-all' (Full history) in defaults
    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    // Verify initial state: temp is 'T'
    await expect(leftKbd).toHaveText('T')

    // Find Full history row in Time Range section (it's the 6th time entry - after 1d, 3d, 7d, 14d, 30d)
    // Time Range table is the second h3's following table
    const timeRangeTable = page.locator('.shortcuts-modal h3:has-text("Time Range") + table')
    const fullHistoryRow = timeRangeTable.locator('tr', { hasText: 'Full history' })
    const fullHistoryKbd = fullHistoryRow.locator('kbd')

    // Verify initial state: Full history is 'X'
    await expect(fullHistoryKbd).toHaveText('X')

    // Now assign 'x' to Temperature
    await leftKbd.click()
    await page.keyboard.press('x')
    await page.waitForTimeout(500)

    // Verify Temperature now shows 'X' with conflict styling
    await expect(leftKbd).toHaveText('X')
    await expect(leftKbd).toHaveClass(/conflict/)

    // CRITICAL: Verify Full history ALSO shows 'X' (same key, because both are bound to 'x')
    await expect(fullHistoryKbd).toHaveText('X')
    await expect(fullHistoryKbd).toHaveClass(/conflict/)

    // Verify the conflict warning banner is shown
    const warningBanner = page.locator('.shortcuts-conflict-warning')
    await expect(warningBanner).toBeVisible()
    await expect(warningBanner).toContainText('conflicts')

    // Close modal
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Click body to focus
    await page.locator('body').click({ position: { x: 10, y: 10 } })

    // Verify the y-axis is still on temp (initial value)
    const yAxisDropdown = page.locator('.legend-metric-control select').first()
    await expect(yAxisDropdown).toHaveValue('temp')

    // Press 'x' - should NOT switch because it's disabled due to conflict
    await page.keyboard.press('x')
    await page.waitForTimeout(300)

    // Should still be temp (x is disabled)
    await expect(yAxisDropdown).toHaveValue('temp')
  })

  test('reassigning hotkey cleans up old overrides', async ({ page }) => {
    // This tests the bug where reassigning a hotkey left old overrides in localStorage
    // e.g., assigning '2' then '3' then '4' to same action would result in
    // { '2': action, '3': action, '4': action } instead of just { '4': action }

    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    // Assign 'q' to temp
    await leftKbd.click()
    await page.keyboard.press('q')
    await page.waitForTimeout(300)
    await expect(leftKbd).toHaveText('Q')

    // Reassign to 'w'
    await leftKbd.click()
    await page.keyboard.press('w')
    await page.waitForTimeout(300)
    await expect(leftKbd).toHaveText('W')

    // Reassign to 'e'
    await leftKbd.click()
    await page.keyboard.press('e')
    await page.waitForTimeout(300)
    await expect(leftKbd).toHaveText('E')

    // Check localStorage - should only have 'e': 'left:temp', not 'q' or 'w'
    const storage = await page.evaluate(() => localStorage.getItem('awair-hotkeys'))
    const overrides = JSON.parse(storage || '{}')

    // Should only have one entry for this action
    expect(Object.keys(overrides).filter(k => overrides[k] === 'left:temp')).toHaveLength(1)
    expect(overrides['e']).toBe('left:temp')
    expect(overrides['q']).toBeUndefined()
    expect(overrides['w']).toBeUndefined()
  })

  test('reset button restores default hotkeys', async ({ page }) => {
    // Click to focus, then open modal and change temp to 'x'
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('?')
    await page.waitForSelector('.shortcuts-modal', { timeout: 5000 })

    const tempRow = page.locator('.shortcuts-table tbody tr').first()
    const leftKbd = tempRow.locator('td:nth-child(2) kbd')

    await leftKbd.click()
    await page.keyboard.press('x')
    await page.waitForTimeout(500)
    await expect(leftKbd).toHaveText('X')

    // Click Reset button
    await page.locator('.shortcuts-modal .reset-button').click()
    await page.waitForTimeout(300)

    // Verify it's back to 'T'
    await expect(leftKbd).toHaveText('T')
  })
})
