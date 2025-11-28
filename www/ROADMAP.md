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

### File Layout Analysis (2025-11-28)

**Current file structure** (`awair-17617.parquet`, 3.9MB, 25 row groups):
```
[RG0][RG1]...[RG24][Footer]
 ^--- immutable ---^  ^-- last RG may grow

Each RG: ~10k rows (~7 days), ~90-160KB, all columns contiguous
Footer: ~24KB (but 512KB initial fetch is hyparquet default)
```

**Key findings:**
- Row groups ARE contiguous (no gaps between columns or RGs)
- Footer is only ~24KB, but hyparquet fetches 512KB to be safe
- 512KB initial fetch includes ~4 recent RGs (~28 days of data)
- For views ≤28 days, **no additional fetch needed** beyond initial!
- For 30d view: needs 5 extra Range requests for older RGs

**Interval analysis:**
- 99.93% of intervals are >1 min (slow drift), 0.07% are <1 min (fast drift)
- Average interval: 1.005 min → ~10,028 rows per 7 days
- Reduced `SAFETY_MARGIN` from 1.5 to 1.01

**RG size tuning:**
- Current: 10,000 rows = 6.94 days (pathological for 7d view - always needs 2 RGs)
- Drift analysis: 99.93% slow (>1min), 0.07% fast (<1min), avg 1.005 min/row
- Recommended: **10,200 rows = ~7.1 days** (margin for rare sub-minute drift)
- To update: `python scripts/rewrite_parquet_row_groups.py s3://380nwk/awair-{id}.parquet 10200`

### Implementation Status

**Completed:**
- `ParquetCache` class (`www/src/services/parquetCache.ts`)
  - LRU cache with size-based eviction for RG blobs
  - "Tail cache" for last RG + footer (the mutable part)
  - Open-ended Range request (`bytes={lastRG}-`) for polling updates
  - Coalesced Range requests for fetching multiple RGs at once
  - Automatic promotion of immutable RGs to blob cache

- `LRUCache` class (`www/src/services/lruCache.ts`)
  - Simple LRU with max size in bytes
  - O(1) get/set using Map iteration order

- `HyparquetSource` integration (`www/src/services/dataSources/hyparquetSource.ts`)
  - Uses `ParquetCache` for row-group-level caching
  - Selects needed RGs using timestamp stats (not row count estimation)
  - Global cache manager maintains one cache per URL
  - `refresh()` method for polling updates

- `fetchAwairData` wiring (`www/src/services/awairService.ts`)
  - Now uses `HyparquetSource` with caching
  - `refreshDeviceData()` for manual cache refresh

- TanStack Query polling (`www/src/hooks/useMultiDeviceData.ts`)
  - `refetchInterval` and `refetchIntervalInBackground` options
  - 60-second polling enabled by default (only when tab active)

**Not yet done:**
- IndexedDB persistence (currently in-memory only)
- Phase-shifted polling (poll ~5-10s after Lambda updates)

### Optimal Fetch Pattern

```
Initial load (512KB):
  [HEAD] → file size
  [GET bytes=-512KB] → footer + ~4 recent RGs

Polling update (every 1 min):
  [HEAD] → check if file grew
  [GET bytes={lastRG.start}-] → last RG + any new RGs + footer

On-demand (user selects longer range):
  [GET bytes={firstMissing.start}-{lastMissing.end}] → one coalesced request
```

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
- Default view (1d, 2 devices): 2 Parquet requests only (HEAD + Range each)
- Main JS bundle: 1.5MB (after plotly-basic.min.js optimization)
- Parquet files: 524KB + 266KB via Range requests
- For views ≤28 days: no additional fetches beyond initial 512KB/file
