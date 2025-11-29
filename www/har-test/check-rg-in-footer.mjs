import { asyncBufferFromUrl, parquetMetadataAsync } from 'hyparquet'

const url17617 = 'https://380nwk.s3.amazonaws.com/awair-17617.parquet'

const file = await asyncBufferFromUrl({ url: url17617 })
const metadata = await parquetMetadataAsync(file)

const fileSize = file.byteLength
const footerStart = fileSize - (1 << 19) // 512KB from end

console.log('=== Footer vs Row Groups ===')
console.log('Footer fetch starts at byte: ' + footerStart)
console.log('File size: ' + fileSize)
console.log()

// Check which row groups are WITHIN the footer fetch
console.log('Row groups contained in footer fetch (last 512KB):')
let rowOffset = 0
for (let i = 0; i < metadata.row_groups.length; i++) {
  const rg = metadata.row_groups[i]
  const cols = rg.columns
  const startByte = Math.min(...cols.map(c => Number(c.meta_data.data_page_offset || c.meta_data.dictionary_page_offset)))
  const endByte = Math.max(...cols.map(c => {
    const offset = c.meta_data.data_page_offset || c.meta_data.dictionary_page_offset
    return Number(offset) + Number(c.meta_data.total_compressed_size)
  }))
  
  // Check if this RG is fully within the footer fetch
  const inFooter = startByte >= footerStart
  const rowStart = rowOffset
  const rowEnd = rowOffset + Number(rg.num_rows)
  rowOffset = rowEnd
  
  if (inFooter || endByte >= footerStart) {
    console.log('  RG #' + i + ': bytes ' + startByte + '-' + endByte)
    console.log('    Rows ' + rowStart + '-' + rowEnd + ' (timestamps: ' + 
      rg.columns[0].meta_data?.statistics?.min_value + ' to ' +
      rg.columns[0].meta_data?.statistics?.max_value + ')')
    console.log('    ' + (inFooter ? 'FULLY IN FOOTER' : 'PARTIALLY IN FOOTER'))
  }
}

console.log()

// How many days are in the last few row groups?
const lastRG = metadata.row_groups[metadata.row_groups.length - 1]
const minTs = new Date(lastRG.columns[0].meta_data?.statistics?.min_value)
const maxTs = new Date(lastRG.columns[0].meta_data?.statistics?.max_value)
console.log('Last RG spans: ' + minTs.toISOString() + ' to ' + maxTs.toISOString())
console.log('Days in last RG: ' + ((maxTs - minTs) / (1000 * 60 * 60 * 24)).toFixed(1))

// Last 5 row groups
console.log()
console.log('=== Last 5 Row Groups ===')
for (let i = metadata.row_groups.length - 5; i < metadata.row_groups.length; i++) {
  const rg = metadata.row_groups[i]
  const minTs = new Date(rg.columns[0].meta_data?.statistics?.min_value)
  const maxTs = new Date(rg.columns[0].meta_data?.statistics?.max_value)
  const days = ((maxTs - minTs) / (1000 * 60 * 60 * 24)).toFixed(1)
  console.log('RG #' + i + ': ' + days + ' days (' + minTs.toISOString().split('T')[0] + ' to ' + maxTs.toISOString().split('T')[0] + ')')
}
