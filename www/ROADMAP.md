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

**HAR Testing:**
- Playwright has native `recordHar` support
- Can filter to `.parquet` URLs
- Verify 206 responses, analyze Range headers, check total bytes

```javascript
const context = await browser.newContext({
  recordHar: { path: 'parquet.har', urlFilter: /\.parquet$/ }
});
```

**Potential standalone library:** `parquet-cache` or similar for browser-based Parquet with smart caching.

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

**Implementation order:**
1. `s3-duckdb-wasm` - Compare performance with hyparquet
2. `lambda` - Python Lambda with SnapStart, return aggregated JSON
3. `cfw` - If Lambda latency unacceptable

---

## 4. Aggregation Window Control (NEXT)

**Goal:** User-configurable aggregation granularity with smart defaults.

**Current state:**
- Fixed `targetPoints = 300`
- Auto-selects smallest TIME_WINDOW keeping points <= 300
- No user control
- Mobile gets same 300 target as desktop (too dense)

**TIME_WINDOWS available:**
```typescript
['1m', '2m', '3m', '5m', '10m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '2d']
```

**Proposed changes:**

1. **Responsive targetPoints:**
   ```typescript
   const targetPoints = Math.max(100, Math.floor(windowWidth / 4))
   // 375px mobile → 93 points
   // 1200px desktop → 300 points
   ```

2. **New control group UI:**
   ```
   Aggregation:  [▾ 5m]  ← dropdown of valid windows
   289 windows (5m each)  ← existing info text
   ```

3. **Window filtering logic:**
   - Min: smallest window giving >= 50 points (avoid too sparse)
   - Max: largest window giving <= 1000 points (avoid too dense)
   - Default: auto-selected based on responsive targetPoints

4. **URL param:** `&agg=5m` to persist selection

**Files to modify:**
- `www/src/hooks/useDataAggregation.ts` - Add window width param, export valid windows
- `www/src/components/AggregationControl.tsx` - New component
- `www/src/components/ChartControls.tsx` - Include new control
- `www/src/App.tsx` - Wire up state + URL param
