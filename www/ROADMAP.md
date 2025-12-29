# Awair Dashboard Roadmap

## Priority Order

1. **UI Polish & Improvements** - High-impact QoL fixes (Section 1)
2. **Hotkey Library** - Extractable standalone project (Section 2)
3. **Performance & Caching** - Further optimizations (Section 3)
4. **Alternative Data Sources** - Comparison framework (Section 4)
5. **Network Profiling** - Automated benchmarking (Section 5)

---

## 1. UI Polish & Improvements

(No current items)

---

## 2. Hotkey Library

**✅ Completed:** [use-kbd](https://github.com/runsascoded/use-kbd) - standalone library for vim-style keyboard shortcuts.

**Features:**
- Multi-key sequences ("d g" for Gym, "d b" for BR)
- Runtime-editable keybindings with capture UI
- Built-in `<ShortcutsModal>`, `<Omnibar>`, `<SequenceModal>` components
- React hooks API (`useAction`, `useHotkeysContext`)

---

## 3. Performance & Caching (ParquetCache Optimization)

**Goal:** Efficient incremental fetching with row-group-level caching.

### File Layout Analysis (2025-11-28)

**Current file structure** (`awair-17617.parquet`, 3.9MB, 25 row groups):
```
[RG0][RG1]...[RG24][Footer]
 ^--- immutable ---^  ^-- last RG may grow

Each RG: ~10k rows (~7 days), ~90-160KB, all columns contiguous
Footer: ~24KB (now using 128KB initial fetch instead of 512KB default)
```

**Key findings:**
- Row groups ARE contiguous (no gaps between columns or RGs)
- Footer is only ~24KB; hyparquet default was 512KB but is configurable
- 128KB initial fetch includes footer + ~1 recent RG (~7 days of data)
- For views >7 days: coalesced Range request fetches additional needed RGs
- Immutable RGs promoted to blob cache (LRU eviction for memory management)

**Interval analysis:**
- 99.93% of intervals are >1 min (slow drift), 0.07% are <1 min (fast drift)
- Average interval: 1.005 min → ~10,028 rows per 7 days
- Reduced `SAFETY_MARGIN` from 1.5 to 1.01

**RG size tuning:**
- ✅ **Current: 10,200 rows = ~7.1 days** (already optimal!)
- Drift analysis: 99.93% slow (>1min), 0.07% fast (<1min), avg 1.005 min/row
- Margin accommodates rare sub-minute drift spikes
- Each RG: ~150-160KB, well-sized for single Range requests

### Implementation Status

**Completed:**
- `ParquetCache` class (`www/src/services/parquetCache.ts`)
  - LRU cache with size-based eviction for RG blobs
  - "Tail cache" for last RG + footer (the mutable part)
  - Open-ended Range request (`bytes={lastRG}-`) for polling updates
  - Coalesced Range requests for fetching multiple RGs at once
  - Automatic promotion of immutable RGs to blob cache
  - AsyncBuffer coalescing: assembles data from multiple cache sources
  - Configurable `initialFetchSize` (default: 128KB, passed to hyparquet)

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

- Smart polling (`www/src/hooks/useSmartPolling.ts` + `DevicePoller.tsx`)
  - Burst retry at mtime+61s, +62s, +63s, then exponential backoff (10s→5min)
  - Tab visibility handling (suspends when inactive)
  - Independent polling per device (synced to each Lambda's write time)

**Next steps:**
- [ ] IndexedDB persistence (currently in-memory only)
- [ ] CI integration for HAR performance testing

**Potential optimizations (lower priority):**
- Column-specific fetching: Only fetch displayed columns from each RG
  - Pros: Further bandwidth reduction (currently fetching all 7 columns)
  - Cons: Complicates "last RG to EOF" refresh logic, need to track visible columns
  - Current: ~122KB refresh is already very efficient, probably not worth complexity

### Optimal Fetch Pattern

```
Initial load (128KB per file):
  [HEAD] → file size
  [GET bytes=-128KB] → footer + ~1 recent RG

Polling update (every 1 min):
  [HEAD] → check if file grew
  If unchanged: done (no GET)
  If grew: [GET bytes={lastRG.start}-] → ~100KB (last RG + footer)

On-demand (user selects longer range):
  [GET bytes={firstMissing.start}-{lastMissing.end}] → one coalesced request
```

**Optimization notes (2025-11-28):**
- Initial fetch: 128KB covers footer (~24KB) + last RG (~90-110KB) in single request
- Refresh fetch: from `lastRG.startByte` to EOF (~100KB)
- Uses hyparquet's `suffixStart` option to tell it exactly where cached data starts
- Coalescing logic assembles data from multiple cache sources when needed
- **✅ Deployed:** Using `github:runsascoded/hyparquet#dist` (v1.22.1 with `suffixStart`)
- **HAR testing tools:** Added `www/har-test/` for network analysis and benchmarking

---

## 4. Alternative Data Sources

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

## 5. Network Performance Profiling

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
- Default view (1d, 2 devices): HEAD + 128KB Range each (~265KB total parquet data)
- Main JS bundle: 1.5MB (after plotly-basic.min.js optimization)
- Polling with no change: HEAD only (no GET)
- Polling with file growth: ~100KB Range request (last RG + footer, not full 128KB)
- Previous (512KB default): ~800KB initial, ~800KB on refresh
- Current (split sizes): ~265KB initial, ~100KB on refresh (~85% reduction)

