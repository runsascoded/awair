import { readFileSync } from 'fs'

const har = JSON.parse(readFileSync('awair.har', 'utf8'))
const parquetEntries = har.log.entries.filter(e => e.request.url.includes('.parquet'))

for (const entry of parquetEntries) {
  const url = entry.request.url.split('/').pop()
  const rangeHeader = entry.request.headers.find(h => h.name.toLowerCase() === 'range')
  const contentLength = entry.response.headers.find(h => h.name.toLowerCase() === 'content-length')
  console.log(url + ':')
  console.log('  Range: ' + (rangeHeader ? rangeHeader.value : 'none'))
  console.log('  Content-Length: ' + (contentLength ? contentLength.value : 'unknown'))
  console.log('  Time: ' + Math.round(entry.time) + 'ms')
  console.log()
}
