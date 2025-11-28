# Awair Dashboard Roadmap

## 1. Hotkey Library (`use-hotkeys` or similar)

**Goal:** Standalone library for vim-style keyboard shortcuts with customization UI.

**Requirements:**
- Multi-key sequences ("d g" for Gym, "d b" for BR)
- Runtime-editable keybindings with capture UI
- Built-in popup showing all shortcuts
- React hooks API

**Research findings:**
| Library | Sequences | Runtime Edit | UI | Status |
|---------|-----------|--------------|-----|--------|
| tinykeys | Yes | No | No | Active, tiny |
| react-hotkeys | Yes | Yes (`recordKeyCombination`) | Yes | Unmaintained 6yr |
| react-hotkeys-hook | No | No | Partial | Active, popular |
| mousetrap | Yes | Yes | No | Unmaintained 6yr |
| kbar/cmdk | No | Via props | Yes (palette) | Active |

**Recommendation:** Build new library combining:
- tinykeys' sequence parsing (or similar)
- react-hotkeys' `recordKeyCombination` concept
- Built-in `<ShortcutsModal>` and `<KeybindingEditor>` components

**Gap:** No actively-maintained library has all three: sequences + runtime editing + UI.

---

## 2. Parquet Fetch Optimization

**Goal:** Efficient incremental fetching with row-group-level caching.

**Current state:**
- Uses `hyparquet` with `asyncBufferFromUrl()` for HTTP Range Requests
- React Query caches at query level (2min stale, 3min refetch)
- No row-group-level caching
- Single row group per file currently (limits optimization)

**Desired architecture:**
```
Parquet File Structure:
[RG0][RG1][RG2]...[RGn-1][RGn][Footer]
 ^--- immutable ---^     ^-- mutable (last RG grows)

Caching Strategy:
- Cache RG0..RGn-1 permanently (immutable)
- Poll only: [last RG start offset → EOF] every minute
- Detect when new RG starts, update cursor
```

**Implementation plan:**
1. Configure writer to use `row_group_size=10000` (enables partial fetches)
2. Build `ParquetCache` layer:
   - IndexedDB for row group chunks
   - Track byte offsets per cached RG
   - Only fetch from last-cached-RG-end to EOF
3. Optimize hyparquet usage:
   - Use metadata to identify RG boundaries
   - Fetch only needed RGs via Range headers

---

## 3. Alternative Data Sources

**Current:** `s3-hyparquet` only

**Planned sources:**

| Source | Implementation | Pros | Cons |
|--------|---------------|------|------|
| `s3-hyparquet` | Direct S3 + hyparquet | No server, works offline | Full client processing |
| `s3-duckdb-wasm` | Direct S3 + DuckDB-WASM | SQL queries, fast aggregation | Large WASM bundle |
| `lambda` | SnapStart Lambda + DuckDB | Server-side aggregation | Cold start latency |
| `cfw` | CloudFlare Worker | ~5ms cold start, edge | CF ecosystem |

**Interface already defined** in `www/src/services/dataSource.ts`:
```typescript
export interface DataSource {
  readonly type: DataSourceType
  fetch(options: FetchOptions): Promise<FetchResult>
}
```

---

## 4. Network Performance Profiling

**Goal:** Automated network performance benchmarking via headless browser.

**Use cases:**
- Benchmark different data source implementations (hyparquet vs DuckDB-WASM vs Lambda)
- Track performance regressions over time
- Compare load times across different time ranges / data sizes

**Approach:** Use [puppeteer-har](https://github.com/Everettss/puppeteer-har) to capture HAR, post-process to extract key metrics.

**Example script:**
```javascript
import puppeteer from 'puppeteer'
import PuppeteerHar from 'puppeteer-har'

const browser = await puppeteer.launch({ headless: true })
const page = await browser.newPage()
const har = new PuppeteerHar(page)

await har.start({ path: 'awair.har' })
await page.goto('https://awair.runsascoded.com/?d=+br', { waitUntil: 'networkidle0' })
await page.waitForFunction('window.chartReady', { timeout: 30000 })
await har.stop()
await browser.close()
```

**Output format** (post-processed from HAR):
```json
{
  "url": "https://awair.runsascoded.com/?d=+br",
  "timestamp": "2025-11-28T05:34:00Z",
  "chartReadyMs": 1234,
  "requests": [
    {"url": "awair-17617.parquet", "bytes": 524288, "ms": 195},
    {"url": "awair-137496.parquet", "bytes": 265616, "ms": 115}
  ],
  "totals": {"bytes": 6302683, "requests": 9}
}
```

**Initial results** (2025-11-28):
- 9 requests, 6.3MB total
- Main JS bundle: 5.2MB, 266ms
- Parquet files: 524KB + 266KB, ~115-195ms each
