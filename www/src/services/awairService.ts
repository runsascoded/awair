import { parquetRead } from 'hyparquet'
import type { AwairRecord, DataSummary } from '../types/awair'

export interface Device {
  name: string
  deviceId: number
  deviceType: string
}

const S3_BUCKET = 'https://380nwk.s3.amazonaws.com'
const DEVICES_CACHE_KEY = 'awair-devices-cache'
const CACHE_TTL = 3600000 // 1 hour in milliseconds

export async function fetchDevices(): Promise<Device[]> {
  // For now, hardcode devices since we can't safely expose API token in frontend
  // In a production app, this would come from a backend API
  const devices: Device[] = [
    { name: 'Gym', deviceId: 17617, deviceType: 'awair-element' },
    { name: 'BR', deviceId: 137496, deviceType: 'awair-element' }
  ]

  return devices
}

function getParquetUrl(deviceId: number): string {
  return `${S3_BUCKET}/awair-${deviceId}.parquet`
}

export async function fetchAwairData(deviceId?: number): Promise<{ records: AwairRecord[]; summary: DataSummary }> {
  // If no device ID provided, use first available device
  if (!deviceId) {
    const devices = await fetchDevices()
    if (devices.length === 0) {
      throw new Error('No devices found')
    }
    deviceId = devices[0].deviceId
  }

  const url = getParquetUrl(deviceId)
  console.log(`🔄 Checking for new data from device ${deviceId}...`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()

  let rows: any[] = []
  await parquetRead({
    file: arrayBuffer,
    onComplete: (data) => {
      if (Array.isArray(data)) {
        rows = data
      }
    }
  })

  if (rows.length === 0) {
    throw new Error('No data found in Parquet file')
  }

  // Convert array format to typed records
  const records: AwairRecord[] = rows.map((row: any[]) => ({
    timestamp: row[0],
    temp: Number(row[1]),
    co2: Number(row[2]),
    pm10: Number(row[3]),
    pm25: Number(row[4]),
    humid: Number(row[5]),
    voc: Number(row[6]),
  }))

  // Sort by timestamp (newest first)
  records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  // Calculate summary
  const count = records.length
  const latest = count > 0 ? records[0].timestamp : null
  const earliest = count > 0 ? records[count - 1].timestamp : null

  let dateRange = 'No data'
  if (earliest && latest) {
    const formatCompactDate = (date: Date) => {
      const month = String(date.getMonth() + 1)
      const day = String(date.getDate())
      const year = String(date.getFullYear()).slice(-2)
      return `${month}/${day}/${year}`
    }

    const start = formatCompactDate(new Date(earliest))
    const end = formatCompactDate(new Date(latest))
    dateRange = start === end ? start : `${start} - ${end}`
  }

  const summary: DataSummary = { count, earliest, latest, dateRange }

  if (latest) {
    console.log(`📊 New data fetched - ${count} records, latest: ${latest}`)
  } else {
    console.log('📊 No new data available')
  }

  return { records, summary }
}
