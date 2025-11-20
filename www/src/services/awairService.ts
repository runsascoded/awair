import { parquetRead } from 'hyparquet'
import type { AwairRecord, DataSummary } from '../types/awair'

export const S3_PARQUET_URL = 'https://380nwk.s3.amazonaws.com/awair-17617.parquet'

export async function fetchAwairData(): Promise<{ records: AwairRecord[]; summary: DataSummary }> {
  console.log('🔄 Checking for new data...')
  const response = await fetch(S3_PARQUET_URL)
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
