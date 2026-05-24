# Port awair to `pyrmts`

Migrate awair's chart from client-side parquet binning (`hyparquetSource.ts`)
to the new `pyrmts` library: pre-aggregated tier shards in R2, served by a
new `cfw/serve/` worker, consumed by the chart via `usePyramid`.

This is the **awair v0.1 milestone** in `pyrmts/SPEC.md` (§Sequencing #1) —
the first real consumer, validating the read-side API against a non-`ctbk`
project.

## What `pyrmts` provides

Lib lives at `~/c/pyrmts`. The read-side is feature-complete on `main`
(8 commits, ~2100 LOC src+tests, 64 tests passing). Public API used here:

- `pyrmts`: `parsePyramidYaml`, `pyramidFromConfig`, `planQuery`, `stitch`,
  `fetchSegmentRows`, `memStorage`, `usePyramid`, `fetchPyramidQuery`
- `pyrmts-cfw`: `r2Storage(bucket)`, `serveQuery({pyramid, request, watermarks?, cors?})`

Pyramid YAML format (see `pyrmts/SPEC.md` §YAML schema for the full grammar).

No npm publish yet — depend via Git SHA. The repo has a `dist`-style branch
publishing setup planned but not landed, so for now use a Git-direct
dependency or wait for the first `dist-…` branch.

## Target architecture

```
                                    ┌──────────────────────────────────┐
Lambda (existing)                   │ R2 bucket `awair`        │
  ↓ writes monthly raw              │   awair-{id}/raw/{YYYY-MM}.parquet│
S3 `380nwk/awair-{id}/{YYYY-MM}.pqt │   awair-{id}/h1/{YYYY-MM}.parquet │
  ↓ Python builder reads            │   awair-{id}/d1/{YYYY}.parquet    │
  ↓ writes tier shards              │   awair-{id}/mo1/{YYYY}.parquet   │
                                    └──────────────┬───────────────────┘
                                                   │ R2 binding
                                       ┌───────────▼───────────┐
                                       │ cfw/serve (new)       │
                                       │   pyrmts-cfw          │
                                       │   serveQuery(...)      │
                                       └───────────┬───────────┘
                                                   │ JSON
                                       ┌───────────▼───────────┐
                                       │ www chart             │
                                       │   usePyramid(...)      │
                                       └────────────────────────┘
```

Existing raw in S3 stays untouched — the builder reads it, doesn't replace
it. Tier shards live in a new R2 bucket so the worker doesn't pay egress
crossing back to S3.

## What changes in awair

| File / path | Action |
|---|---|
| `cfw/serve/` (new) | New worker. Uses `pyrmts-cfw#serveQuery`. Sibling to `cfw/monitor/`. |
| `cfw/serve/wrangler.toml` | Bind R2 bucket `awair`. Set ALLOWED_ORIGINS. |
| `cfw/serve/src/index.ts` | Load `pyramid.yml` (import as text), wire `r2Storage(env.PYRAMID)`, delegate to `serveQuery`. |
| `cfw/serve/src/pyramid.yml` | Pyramid YAML (see §Pyramid config below). |
| `src/awair/pyrmts_builder.py` (new) | CLI: build tier shards from existing monthly S3 raw files. |
| `www/src/services/dataSources/pyrmtsSource.ts` (new) | New `DataSource` impl backed by the `cfw/serve` endpoint. Wraps `pyrmts#fetchPyramidQuery`. |
| `www/src/types/awair.ts` | Add an adapter `pyramidRowToAwairRecord(row)` — pyrmts emits `{ts, temp_n, temp_sum, temp_sumsq, ...}`; chart wants `{timestamp, temp, ...}` (mean from `_sum/_n`). |
| `www/src/services/dataSources/hyparquetSource.ts` | **Keep** until pyrmts source is proven a-vs-b. Delete in a follow-up. |
| `www/src/services/parquetCache.ts` | Same — keep, then delete. |
| `www/src/hooks/useDataAggregation.ts`, `useMultiDeviceAggregation.ts` | Replace internal binning with `usePyramid` once the chart consumes the new source. |
| `www/src/services/dataSource.ts` | Add `'pyrmts-cfw'` to `DataSourceType`. |

## Pyramid config

`cfw/serve/src/pyramid.yml`:

```yaml
storage:
  type: r2
  binding: PYRAMID
  bucket: awair
  key: 'pyramid/awair-{device_id}/{tier}/{period}.parquet'

dims:
  - { name: device_id, type: int }

metrics:
  - { name: temp,  monoid: sum }
  - { name: co2,   monoid: sum }
  - { name: pm10,  monoid: sum }
  - { name: pm25,  monoid: sum }
  - { name: humid, monoid: sum }
  - { name: voc,   monoid: sum }

tiers:
  - { name: raw, bin: 1min, shard: 1mo }
  - { name: h1,  bin: 1h,   shard: 1mo }
  - { name: d1,  bin: 1d,   shard: 1y  }
  - { name: mo1, bin: 1mo,  shard: 1y  }
```

The `sum` monoid stores `(n, sum, sumsq)` per metric → the chart can render
mean ± stddev at any tier without re-reading raw data.

Default `binCol: ts` (int64 UTC ms). Default `axis: time`.

## Parquet schema (per-shard)

Each shard has columns:

| Column | Type | Notes |
|---|---|---|
| `ts` | INT64 | UTC ms timestamp at the bin start |
| `device_id` | INT32 | Dim |
| `temp_n` | INT32 | Sum-monoid state: count of readings |
| `temp_sum` | DOUBLE | Sum-monoid state: sum of readings |
| `temp_sumsq` | DOUBLE | Sum-monoid state: sum of squares |
| (similarly for co2, pm10, pm25, humid, voc) | | |

Sort: `(device_id, ts)` for predicate pushdown when filtering by device.
Row group sizing: default; revisit if shards get large.

## Python builder

New CLI: `awair build-pyramid` (or `python -m awair.pyrmts_builder`).

```bash
# Build a single tier-period from a finer source.
awair build-pyramid --tier raw --period 2026-05 \
  --from-s3 s3://380nwk/awair-17617/2026-05.parquet \
  --device-id 17617 \
  --r2-bucket awair

# Coarsen h1 from raw, d1 from h1, etc.
awair build-pyramid --tier h1 --period 2026-05 --from-tier raw --device-id 17617
awair build-pyramid --tier d1 --period 2026 --from-tier h1 --device-id 17617
awair build-pyramid --tier mo1 --period 2026 --from-tier d1 --device-id 17617
```

For the raw tier: each reading from the existing monthly S3 file becomes one
row with `(temp_n=1, temp_sum=temp, temp_sumsq=temp²)`. UTC-floor `timestamp`
to the minute for `ts`. Group duplicates within a minute (if any) via the
sum monoid before writing.

For coarsening: read source-tier rows, group by `(device_id, floor(ts,
target_bin))`, sum each metric's `(n, sum, sumsq)` triple.

For first run / backfill: a `backfill-all` subcommand iterates all devices
and all (tier, period) pairs.

R2 access from Python: `boto3` against the R2 S3-compatible endpoint, using
account-scoped credentials. Or `wrangler r2 object put` shelled out. Pick
based on whichever is simpler — the build step is offline, not perf-sensitive.

## FE wiring

```ts
// www/src/services/dataSources/pyrmtsSource.ts
import { fetchPyramidQuery } from 'pyrmts'
import type { DataSource, FetchOptions, FetchResult } from '../dataSource'

const PYRMTS_URL = import.meta.env.VITE_PYRMTS_URL ?? 'https://awair-pyrmts.…workers.dev/q'

export class PyrmtsSource implements DataSource {
  type = 'pyrmts-cfw' as const
  async fetch(opts: FetchOptions): Promise<FetchResult> {
    const t0 = performance.now()
    const { records, plan } = await fetchPyramidQuery({
      url: PYRMTS_URL,
      range: opts.range,
      binBudget: chartContainerPx(),   // see chart code
      filter: { device_id: opts.deviceId },
    })
    return {
      records: records.map(pyramidRowToAwairRecord),
      timing: { /* … */ source: 'pyrmts-cfw' },
    }
  }
}

function pyramidRowToAwairRecord(r: Record<string, unknown>): AwairRecord {
  const n = r.temp_n as number
  return {
    timestamp: new Date(r.ts as number),
    temp:  (r.temp_sum  as number) / n,
    co2:   (r.co2_sum   as number) / n,
    pm10:  (r.pm10_sum  as number) / n,
    pm25:  (r.pm25_sum  as number) / n,
    humid: (r.humid_sum as number) / n,
    voc:   (r.voc_sum   as number) / n,
  }
}
```

(Refine stddev display later from `temp_sumsq` if/when chart wants error
bands. The monoid keeps the state; the adapter is throwaway.)

## Phasing

1. **Backfill** (offline): build tier shards for the existing months (~all
   of awair's history). Validate via `pyrmts inspect` (or by spot-checking
   a/b vs current chart).
2. **CFW serve** (offline): deploy `cfw/serve/` with the R2 binding. Smoke
   test with `curl`. Add CORS for the chart's origin.
3. **A/B in chart**: add `PyrmtsSource` as a selectable `DataSource`, keep
   `HyparquetSource` as default. Compare latency, bytes, parity on a few
   real ranges. Toggle via URL param or env.
4. **Switch default + clean up**: promote `PyrmtsSource` to default; delete
   `HyparquetSource`, `parquetCache.ts`, and the client-side aggregation in
   `useDataAggregation.ts` and `useMultiDeviceAggregation.ts`.
5. **In-progress / live tail** (phase 2): a Lambda step (or builder cron)
   keeps `raw` watermark within ~1 minute of now; the worker reports
   `authoritativeEnd` and the chart can decide what to render past it.

Phases 1–4 are the v0.1 commitment. Phase 5 closes the SPEC §Open questions
"In-progress-tier caching" loop.

## Open questions

- **R2 bucket layout**: chose bucket `awair` with `pyramid/` key prefix
  (vs. a dedicated `awair-pyramid` bucket or reusing the existing S3
  `380nwk` bucket). Keeps room for other awair-related R2 objects without
  proliferating buckets.
- **Worker subdomain**: `awair-pyrmts.…workers.dev` or behind `air.rbw.sh`
  via a Cloudflare route?
- **R2 writes from Python**: `boto3` vs `wrangler r2 object put`. Whichever
  the user finds less annoying to credential.
- **Devices.parquet**: the device list (`devices.parquet` at S3 root) is
  unrelated to the time-series pyramid. Keep its current loader (`awair`
  service); pyrmts doesn't touch it.

## References

- `pyrmts/SPEC.md` — design doc (especially §Sequencing, §YAML schema, §Core concepts).
- `pyrmts/js/packages/pyrmts/src/` — `planner.ts`, `stitch.ts`, `axis.ts`,
  `yaml.ts`, `query.ts`, `use-pyramid.ts`.
- `pyrmts/js/packages/pyrmts-cfw/src/` — `r2.ts`, `serve.ts`.
- `pyrmts/js/packages/pyrmts-cfw/src/serve.test.ts` — end-to-end test:
  hand-built parquet → memStorage → planQuery → fetchSegmentRows → stitch
  → HTTP Response. The exact path this worker will exercise against R2.
- Existing awair files this migration touches (see table above).

Commit pyrmts is built against at the time of writing: `28e1a33`.
