import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { test, expect } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test.describe('Device Selection', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('Browser console:', msg.text()))
    page.on('pageerror', error => console.error('Page error:', error))

    // Intercept S3 requests and serve local snapshot files
    await page.route('**/*.parquet', async route => {
      const request = route.request()
      const url = request.url()
      const method = request.method()

      let filePath: string | null = null
      const testDataMonths = ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11']
      const isTestDataMonth = testDataMonths.some(m => url.includes(`/${m}.parquet`))

      if (url.includes('awair-17617/') && isTestDataMonth) {
        filePath = path.join(__dirname, '../../test-data/awair-17617.parquet')
      } else if (url.includes('awair-17617/')) {
        await route.fulfill({ status: 404 })
        return
      } else if (url.includes('awair-137496/') && isTestDataMonth) {
        filePath = path.join(__dirname, '../../test-data/awair-137496.parquet')
      } else if (url.includes('awair-137496/')) {
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
  })

  test('table device dropdown hides when deselecting leaves one device', async ({ page }) => {
    // Start with both Gym and BR devices selected
    await page.goto('/?d=gym+br&t=251129T1740')
    await page.waitForSelector('.data-table', { timeout: 30000 })

    // Device dropdown should be visible with 2 devices
    const deviceDropdown = page.locator('#device-select')
    await expect(deviceDropdown).toBeVisible()

    // Should have 2 options
    const options = await deviceDropdown.locator('option').all()
    expect(options.length).toBe(2)

    // Deselect BR device
    const brCheckbox = page.locator('.device-checkboxes label:has(span.name:text("BR")) input[type="checkbox"]')
    await brCheckbox.click()
    await page.waitForTimeout(500)

    // Dropdown should be hidden when only 1 device selected
    await expect(deviceDropdown).toBeHidden()

    // Gym checkbox should still be checked
    const gymCheckbox = page.locator('.device-checkboxes label:has(span.name:text("Gym")) input[type="checkbox"]')
    await expect(gymCheckbox).toBeChecked()
  })

  test('table shows remaining device data after deselecting other device', async ({ page }) => {
    // Start with both devices, Gym showing in dropdown
    await page.goto('/?d=gym+br&t=251129T1740')
    await page.waitForSelector('.data-table', { timeout: 30000 })

    const deviceDropdown = page.locator('#device-select')

    // Select Gym in the dropdown so we know what's showing
    await deviceDropdown.selectOption('17617')
    await page.waitForTimeout(300)

    // Verify Gym is selected
    expect(await deviceDropdown.inputValue()).toBe('17617')

    // Deselect Gym (the device currently shown in dropdown)
    const gymCheckbox = page.locator('.device-checkboxes label:has(span.name:text("Gym")) input[type="checkbox"]')
    await gymCheckbox.click()
    await page.waitForTimeout(500)

    // Dropdown should be hidden (only 1 device left)
    await expect(deviceDropdown).toBeHidden()

    // BR should be checked (remaining device)
    const brCheckbox = page.locator('.device-checkboxes label:has(span.name:text("BR")) input[type="checkbox"]')
    await expect(brCheckbox).toBeChecked()

    // Gym should be unchecked
    await expect(gymCheckbox).not.toBeChecked()
  })
})
