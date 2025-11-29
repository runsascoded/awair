# HAR Test - Fetch Optimization Analysis

This directory contains tools for analyzing network requests and optimizing Parquet file fetching.

## Current State

### File Structure (awair-17617.parquet)
- **File size**: ~3.9MB (3,965,411 bytes)
- **Row groups**: 25 RGs, each ~150KB, 10,200 rows (~7 days of 1-min intervals)
- **Last RG (#24)**: 99KB, 6,000 rows, partially filled (~4.2 days)
- **Footer**: 23KB metadata

### Fetch Optimization (Implemented ✅)

The `ParquetCache` class implements intelligent caching:

1. **Initial fetch**: Last 128KB (1 << 17)
   - Starts at byte 3,834,339
   - Gets: partial RG #23 + full RG #24 + footer
   - Size: 128KB

2. **Refresh fetch**: From last RG start to EOF
   - Starts at byte 3,840,486 (last RG start)
   - Gets: full RG #24 + footer
   - Size: 122KB
   - Uses `suffixStart` option in hyparquet v1.22.1+

3. **On-demand fetch**: Specific RGs as needed
   - Fetches only requested row groups
   - Coalesces contiguous RGs into single Range request

### Key Insight

The refresh fetch (122KB) is very close to the initial fetch (128KB) because:
- Last RG: 99KB (can grow as new data arrives)
- Footer: 23KB (always needed for metadata)
- **Total**: 122KB minimum needed for refresh

This is optimal given the current row group size (~150KB).

## Potential Future Optimizations

### 1. Smaller Row Groups

Currently, row groups are ~150KB (10,200 rows ≈ 7 days). Could configure writer to use smaller RGs:

```python
# In Python writer
pq.write_table(table, path, row_group_size=1440)  # 1 day = 1440 rows
```

Benefits:
- Each RG would be ~20-25KB (7× smaller)
- Refresh would only fetch last day + footer ≈ 45KB
- More granular caching (cache hit rate would improve)

Trade-offs:
- More row groups → larger footer metadata
- More overhead for range requests
- Slightly less compression efficiency

### 2. Footer Caching

The footer rarely changes structure (just grows). Could:
- Cache footer separately
- Only re-fetch if file size changed
- Validate footer hash/ETag

Currently not implemented because footer is only 23KB.

## Analysis Scripts

- `extract-ranges.mjs` - Extract Range headers from HAR files
- `analyze-layout.mjs` - Show row group byte layout
- `analyze-drift.mjs` - Analyze timestamp intervals
- `analyze-metadata.mjs` - Parse and display metadata
- `check-rg-in-footer.mjs` - Check which RGs fit in footer fetch
- `test-current-fetch.mjs` - Test current fetch behavior
- `all-requests.mjs` - List all HAR requests
- `detailed-har.mjs` - Detailed HAR analysis

## Running Analysis

```bash
cd www/har-test

# Capture new HAR (requires dev server running)
# npm run dev
# Then visit http://localhost:5173 in browser and export HAR from Network tab
# Or use puppeteer-based capture

# Analyze current fetch behavior
node test-current-fetch.mjs

# Check row group layout
node analyze-layout.mjs

# Extract ranges from HAR
node extract-ranges.mjs
```

## Hyparquet Integration

Using local linked hyparquet with `suffixStart` support:
- `hyparquet@link:../../hyparquet` (v1.22.1)
- Feature: `suffixStart` option in `parquetMetadataAsync`
- Commit: `f8de26b Add suffixStart option to parquetMetadataAsync`

This allows `ParquetCache.refresh()` to tell hyparquet exactly where our cached data starts, avoiding redundant metadata parsing.
