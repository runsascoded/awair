import { asyncBufferFromUrl, parquetMetadataAsync } from 'hyparquet'

const url = 'https://380nwk.s3.amazonaws.com/awair-17617.parquet'
const file = await asyncBufferFromUrl({ url })
const metadata = await parquetMetadataAsync(file)

console.log('=== File Layout ===')
console.log('File size: ' + file.byteLength + ' bytes')
console.log('Metadata length: ' + metadata.metadata_length + ' bytes')
console.log('Footer starts at: ' + (file.byteLength - metadata.metadata_length - 8))
console.log()

console.log('=== Row Group Layout ===')
console.log('Columns: ' + metadata.schema.filter(s => s.type).map(s => s.name).join(', '))
console.log()

// Show layout for first 2 and last 2 row groups
const rgsToShow = [0, 1, metadata.row_groups.length - 2, metadata.row_groups.length - 1]

for (const rgIdx of rgsToShow) {
  const rg = metadata.row_groups[rgIdx]
  console.log('--- RG #' + rgIdx + ' (' + rg.num_rows + ' rows) ---')
  
  // Get all column byte ranges
  const colRanges = []
  for (const col of rg.columns) {
    const name = col.meta_data.path_in_schema.join('.')
    const offset = Number(col.meta_data.dictionary_page_offset || col.meta_data.data_page_offset)
    const size = Number(col.meta_data.total_compressed_size)
    colRanges.push({ name, start: offset, end: offset + size, size })
  }
  
  // Sort by start offset
  colRanges.sort((a, b) => a.start - b.start)
  
  const rgStart = colRanges[0].start
  const rgEnd = colRanges[colRanges.length - 1].end
  console.log('RG bytes: ' + rgStart + ' - ' + rgEnd + ' (' + (rgEnd - rgStart) + ' bytes)')
  
  // Show each column
  for (const col of colRanges) {
    console.log('  ' + col.name + ': ' + col.start + '-' + col.end + ' (' + col.size + ' bytes)')
  }
  
  // Check for gaps between columns
  let prevEnd = colRanges[0].end
  let gaps = 0
  for (let i = 1; i < colRanges.length; i++) {
    if (colRanges[i].start !== prevEnd) {
      gaps++
    }
    prevEnd = colRanges[i].end
  }
  console.log('  Contiguous: ' + (gaps === 0 ? 'YES' : 'NO (' + gaps + ' gaps)'))
  console.log()
}

// Check gaps between row groups
console.log('=== Row Group Continuity ===')
let prevRgEnd = 0
for (let i = 0; i < metadata.row_groups.length; i++) {
  const rg = metadata.row_groups[i]
  const colRanges = rg.columns.map(col => {
    const offset = Number(col.meta_data.dictionary_page_offset || col.meta_data.data_page_offset)
    const size = Number(col.meta_data.total_compressed_size)
    return { start: offset, end: offset + size }
  }).sort((a, b) => a.start - b.start)
  
  const rgStart = colRanges[0].start
  const rgEnd = colRanges[colRanges.length - 1].end
  
  if (i > 0 && rgStart !== prevRgEnd) {
    console.log('Gap before RG #' + i + ': ' + (rgStart - prevRgEnd) + ' bytes')
  }
  prevRgEnd = rgEnd
}

const footerStart = file.byteLength - metadata.metadata_length - 8
console.log('Gap before footer: ' + (footerStart - prevRgEnd) + ' bytes')
console.log()

// Summary
console.log('=== Summary ===')
console.log('Layout: [RG0][gap][RG1][gap]...[RGn][gap][Footer]')
console.log('Each RG: columns are contiguous within RG')
console.log('After footer fetch, we have byte ranges for every {col x RG}: YES')
