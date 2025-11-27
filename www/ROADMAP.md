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

## 4. Dynamic OG Image

**Goal:** Fresh screenshot of the dashboard as the og:image, updated periodically.

**Approach:** Scheduled Lambda (hourly) takes screenshot → uploads to S3 → site references static S3 URL.

**Why not on-demand Lambda at the og:image URL?**
- Social media crawlers have tight timeouts (~2-5s)
- Headless browser screenshot takes several seconds
- Cold start + screenshot would likely exceed timeout
- Pre-generated image is instant and reliable

**Implementation:**
- Lambda with Playwright/Puppeteer (or `@sparticuz/chromium` for Lambda layer)
- Screenshot the live site at a good viewport (1200x630 for og:image)
- Upload to `s3://380nwk/og-image.png` (public)
- EventBridge schedule: hourly
- Site's `<meta property="og:image">` points to the S3 URL
