import { asyncBufferFromUrl, parquetMetadataAsync, parquetRead } from 'hyparquet'

const url = 'https://380nwk.s3.amazonaws.com/awair-17617.parquet'
const file = await asyncBufferFromUrl({ url })
const metadata = await parquetMetadataAsync(file)

// Fetch last 10,000 rows to analyze intervals
let rows = []
const totalRows = Number(metadata.num_rows)
await parquetRead({
  file,
  metadata,
  rowStart: totalRows - 10000,
  rowEnd: totalRows,
  onComplete: data => { rows = data }
})

// Calculate intervals
const intervals = []
for (let i = 1; i < rows.length; i++) {
  const prev = new Date(rows[i-1][0]).getTime()
  const curr = new Date(rows[i][0]).getTime()
  const diffMinutes = (curr - prev) / (1000 * 60)
  intervals.push(diffMinutes)
}

// Check for sub-1-minute intervals
const subMinute = intervals.filter(i => i < 1.0)
const exactlyOne = intervals.filter(i => i === 1.0)
const overOne = intervals.filter(i => i > 1.0)

console.log('=== Drift Analysis (10,000 intervals) ===')
console.log('Sub-1-minute: ' + subMinute.length + ' (' + (subMinute.length / intervals.length * 100).toFixed(2) + '%)')
console.log('Exactly 1 min: ' + exactlyOne.length + ' (' + (exactlyOne.length / intervals.length * 100).toFixed(2) + '%)')
console.log('Over 1 minute: ' + overOne.length + ' (' + (overOne.length / intervals.length * 100).toFixed(2) + '%)')
console.log()

if (subMinute.length > 0) {
  console.log('Sub-minute intervals:')
  subMinute.slice(0, 10).forEach(i => console.log('  ' + i.toFixed(4) + ' min'))
  if (subMinute.length > 10) console.log('  ... and ' + (subMinute.length - 10) + ' more')
}

if (overOne.length > 0) {
  console.log('Over-1-minute intervals:')
  const sorted = overOne.sort((a, b) => b - a)
  sorted.slice(0, 10).forEach(i => console.log('  ' + i.toFixed(2) + ' min'))
}

// Calculate actual rows per 7 days
const totalMinutes = intervals.reduce((a, b) => a + b, 0)
const avgInterval = totalMinutes / intervals.length
const rowsPer7Days = (7 * 24 * 60) / avgInterval

console.log()
console.log('=== 7-Day Calculation ===')
console.log('Average interval: ' + avgInterval.toFixed(6) + ' min')
console.log('Expected rows in 7d: ' + rowsPer7Days.toFixed(0))
console.log('10,080 rows covers: ' + (10080 * avgInterval / 60 / 24).toFixed(3) + ' days')
