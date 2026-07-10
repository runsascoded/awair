# `cfw/cascade`: self-healing pyramid maintenance worker

Add a Cloudflare Worker that keeps awair's pyrmts tier shards up-to-date via
`pyrmts` gap discovery + `converge()`. Replaces the current manual
`awair pyramid build` cadence — upper tiers (m5/m30/h3/d1/d7/mo1) have been
stale for all 4 devices since ~2026-06-01, causing the FE to render blank
when a viewport-driven `bin_budget` picks a coarse tier.

Modeled after ctbk's `gbfs/cascade/` worker (`~/c/hccs/ctbk/gbfs/cascade/`
— specifically `src/avail3/cascade.ts::converge()`), which lands the same
`listMissingShards` → dependency-sorted write → time-budgeted loop we need
here.

## What `pyrmts` provides (that we haven't adopted)

The `pyrmts` repo (`~/c/pyrmts`) shipped four post-`d50b7c8`
generalizations we depend on:

- **`listExpectedShards(pyramid, range, filter?)`** — pure enum over YAML,
  emits `(tier, shardDur, periodStart, periodEnd, effectiveStart,
  effectiveEnd, key)` for every shard a min-cover of `[from, to)` needs.
  `filter` supplies extra `{name}` values for keyTemplate (our
  `{device_id: 17617}` case). See
  `~/c/pyrmts/js/packages/pyrmts/src/gap-discovery.ts`.
- **`listMissingShards(pyramid, name, shardIndex, range, filter?)`** —
  set-diffs `listExpectedShards` against `shardIndex.listShards(name)`.
- **`ShardIndex` interface** (`D1ShardIndex` + `ManifestShardIndex`) —
  records what's been built. Solves our current "was this shard ever
  expected?" ambiguity: today an absent shard is treated as
  complete-through-`to` by the planner (see `cfw/serve/src/index.ts:64`),
  which is why m5/m30 gaps read as `records=0` rather than triggering
  reaggregate-from-raw.
- **Genesis-boundary clipping** (`effective{Start,End}`) — each device's
  own `genesisDate` clips pre-genesis periods so
  `inputsExpected` doesn't count sources that will never exist. Matters
  because the 4 awair devices came online on different dates.

## Target architecture

```
   ┌─────────────────────┐          ┌─────────────────────────────────┐
   │ Lambda × 4 devices  │          │ R2 bucket `awair`               │
   │  1/min via EB       │──raw───▶│   pyramid/awair-{id}/            │
   │  writes raw shard   │          │     raw/{YYYY-MM}.parquet       │
   └─────────────────────┘          │     m5/{YYYY-MM}.parquet        │
                                    │     m30/{YYYY-MM}.parquet       │
   ┌─────────────────────┐          │     h3/{YYYY}.parquet           │
   │ cfw/cascade  (NEW)  │──m5..──▶│     d1/{YYYY}.parquet           │
   │  cron * * * * *     │  mo1    │     d7/{YYYY}.parquet           │
   │  converge() ×       │          │     mo1/{YYYY}.parquet          │
   │    device_id ∈ 4    │          └────────────────┬────────────────┘
   │  reads D1 index     │                           │ R2 binding
   │  writes D1 index    │◀────D1───┐                │
   └──────────┬──────────┘          │      ┌─────────▼────────┐
              │                     │      │ cfw/serve        │
              │  /health JSON       │      │  reads shards    │
              ▼                     │      │  serves /q       │
   ┌─────────────────────┐          │      └─────────┬────────┘
   │ www/pages/Health    │          │                │
   │  cadence per tier   │          │      ┌─────────▼────────┐
   │  latest shard       │          │      │ www chart        │
   │  expected vs        │          │      └──────────────────┘
   │    recorded         │          │
   └─────────────────────┘          │
                                    │
                    ┌───────────────▼───────────────┐
                    │ D1 database `awair-cascade`   │
                    │  pyramid_watermarks table     │
                    │  (pyramidName, tier, shardDur,│
                    │   periodStart, periodEnd, key,│
                    │   recordedAt)                 │
                    └───────────────────────────────┘
```

## Design decisions

### One worker, per-device sequential loop (Shape 1)

Not per-device workers (would multiply deploy/cron infrastructure without
adding meaningful isolation given a per-device try/catch inside the loop
already contains failure). Not `Promise.all` across devices either (shared
subrequest budget makes concurrency add contention risk without meaningful
wall-clock wins at 4 devices).

```ts
export async function convergeAll(env: Env, now: Date): Promise<Report> {
  const devices = await readDevicesFromR2(env)   // s3://380nwk/devices.parquet mirror
  const results: PerDeviceResult[] = []
  const started = Date.now()
  const TOTAL_BUDGET_MS = 25_000
  for (const dev of devices) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started)
    if (remaining <= 500) { results.push({ deviceId: dev.id, status: 'skipped-budget' }); continue }
    try {
      const r = await convergeOne(env, dev, now, { timeBudgetMs: remaining })
      results.push({ deviceId: dev.id, status: 'ok', ...r })
    } catch (e) {
      results.push({ deviceId: dev.id, status: 'error', error: String(e) })
    }
  }
  return { generatedAt: now, results }
}
```

`convergeOne` mirrors ctbk's `converge` (single-tenant): build
`Pyramid`, resolve `filter={device_id: dev.id}`, `listMissingShards`,
sort by (tier depth, then shardDur), for-each with time budget check +
write + `shardIndex.recordShard` on `fullyCovered`.

### Cron every minute

Matches Lambda ingest cadence. raw tier writes are ≤1min stale; cascade's
first tick after raw lands re-derives m5/etc.

Trade-off: 1440 ticks/day × ~32 subreq steady-state = ~46k Worker
requests/day. Well under the 10M/mo Paid included.

### D1 for `ShardIndex`

- Nicer for `/health` ad-hoc queries than `ManifestShardIndex` (JSON blob
  in R2).
- Free-tier headroom is comfortable at expected volume: ~100 rows
  (7 tiers × 4 devices × ~4 shards each including trailing rungs), few
  writes per hour.
- One database, `awair-cascade`, table
  `pyramid_watermarks(pyramidName, tier, shardDur, periodStart, periodEnd,
  key, recordedAt)`. Copy schema from ctbk (`gbfs/api/schema.sql` or the
  `D1ShardIndex` migration in `pyrmts-cfw`).

### Genesis dates

Read from `devices.parquet` if present; fall back to configured defaults
if the column doesn't exist yet. Threaded through as `{device_id, genesis}`
in the converge filter — pyrmts's `listExpectedShards` clips
`effective{Start,End}` accordingly. Genesis-boundary support already
lives in pyrmts commit `3f50c2d`.

## What changes in awair

| File / path | Action |
|---|---|
| `cfw/cascade/` | **New.** Sibling to `cfw/serve/` and `cfw/monitor/`. |
| `cfw/cascade/wrangler.toml` | Cron `* * * * *`, `[[r2_buckets]] PYRAMID = awair`, `[[d1_databases]] DB = awair-cascade`, env vars for devices list URL. |
| `cfw/cascade/src/index.ts` | Worker entrypoint: `scheduled()` → `convergeAll()`; `fetch()` → `/health`, `/converge?tiers=&devices=&dryRun=1` (secret-gated), `/gc-sweep` (deferred). |
| `cfw/cascade/src/cascade.ts` | `convergeAll` + `convergeOne` — the loop above. |
| `cfw/cascade/src/write.ts` | `writeShard(sourceTier, targetTier, period, ...)` — reads previous tier's parquet, re-aggregates with sum monoid, writes to R2. Adapt from ctbk `writeShard`, drop tenant-specific bits, keep pyrmts monoid math. |
| `cfw/cascade/src/health.ts` | Snapshot builder: query D1 for recorded shards, run `listExpectedShards` for `[genesis, now]` per device, diff. |
| `cfw/cascade/src/devices.ts` | Read device list + genesis from D1 (see Phase 1b). |
| `cfw/cascade/migrations/0001_shard_index.sql` | D1 schema for `pyramid_watermarks` (copy pyrmts-cfw's `D1ShardIndex` migration). |
| `cfw/cascade/migrations/0002_devices.sql` | D1 schema for `devices` table (see decisions section for shape). |
| `src/awair/pyramid.yml` | **No changes** — same YAML consumed by cascade + serve. |
| `www/src/pages/Health.tsx` | **New.** Renders `HealthSnapshot`. Clone of `~/c/hccs/ctbk/www/src/pages/Health.tsx` shape, awair-scoped. |
| `www/src/App.tsx` | Add `<Route path="/health">` (or equivalent — check current routing; may need to add react-router). |
| `www/src/services/healthService.ts` | `fetch(HEALTH_URL)` for the FE. |
| `cfw/serve/src/index.ts` | Post-cascade, the "missing shard = complete-through-`to`" behavior stops being load-bearing. **Deferred cleanup:** wire `serveQuery` to consult the same `ShardIndex` so absent + never-recorded → reaggregate; absent + was-recorded-then-deleted → error. |

## Phases

Suggested implementation phases, each shipping independently:

**Phase 1a: offline backfill + cascade worker.**
- `cfw/cascade/` scaffolded, `D1ShardIndex` migration applied.
- `convergeAll` + `convergeOne` + `writeShard` implemented against pyrmts APIs.
- Wrangler cron enabled, `/converge?dryRun=1` for smoke tests.
- Bootstrap per plan above: `awair pyramid backfill -F` on `e`, seed
  `pyramid_watermarks`, deploy cascade with cron.
- Verify FE at `?x=4px` no longer hits empty-state.

**Phase 1b: devices → D1.**
- Migration `0002_devices.sql` applied.
- Seed from current `devices.parquet` (one-shot import script).
- `awair api devices --refresh` writes D1 (dual-write to parquet during
  transition for backwards-compat, or drop parquet if FE migration lands
  in the same PR).
- Cascade reads device list + genesis from D1 (not R2).
- New endpoint on `cfw/serve`: `GET /devices` returning JSON. FE switches
  from R2 parquet fetch to this endpoint.

**Phase 2: `/health` endpoint + www page.**
- `cfw/cascade` exposes `/api/health` returning the `HealthSnapshot`.
- Add `www/src/pages/Health.tsx` cloned from ctbk, TanStack Query at
  60s refresh.
- Route mount in `App.tsx`.

**Phase 3: retire the `awair pyramid build` manual CLI dependency.**
- CLI stays (useful for one-off rebuilds, `--force` sweeps), but no
  workflow depends on it anymore.
- Delete `pyrmts.js` from Lambda deps if it's no longer needed for the
  raw piggyback path (raw is already Lambda's job, but the `aggregate_raw`
  import from Python builder is separate — verify).

**Phase 4 (deferred): retire S3 as write destination.**
- Move Lambda's read+merge+write to R2 (plain get/put — reserved
  concurrency=1 already serializes writes; `utz.s3.atomic_edit`'s
  conditional PUT is defensive-programming leftover).
- Delete S3 writes; leave old S3 files as archive.
- Not blocking anything; nice cleanup.

**Phase 5 (deferred): fix `cfw/serve` "missing shard = complete" wiring.**
- Post-cascade this becomes non-load-bearing (all shards get built), but
  the semantics are still wrong — a shard we never expected should not
  read as "complete".
- Wire `resolveWatermarks` (or a new consult step) to check
  `ShardIndex.listShards` so an unrecorded shard triggers reaggregate.

## Decisions locked in / open items

- **`cfw/serve` (query endpoint `/q`) stays untouched.** Cascade is a
  writer-only peer; not merging read + write into one worker. ctbk keeps
  `api` and `cascade` separate for scaling reasons that don't apply at
  our size, but the separation is also just cleaner — one worker's
  invariants don't leak into the other.
- **D1 for `ShardIndex`.** Decided.
- **Devices as a D1 table in the same DB.** Adopting. `devices.parquet`
  becomes derived output (still generated by `awair api devices --refresh`
  for backwards-compat with the current FE reader, then FE migrates to a
  worker endpoint). Table:
  ```sql
  CREATE TABLE devices (
    device_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL,     -- e.g. 'awair-element'
    genesis_ts INTEGER NOT NULL,   -- unix seconds; first observed data timestamp
    active INTEGER NOT NULL DEFAULT 1,
    last_refreshed_at INTEGER NOT NULL
  );
  ```
  Cascade reads from this directly (no R2/S3 fetch for the device list;
  no filter mismatch between cascade and serve). Migration path: (1) add
  the table + backfill from current `devices.parquet`, (2) cascade + a
  new `cfw/serve` `/devices` endpoint read from D1, (3) www switches to
  the new endpoint, (4) `awair api devices --refresh` writes D1 instead
  of parquet (or dual-writes during the transition).
- **Bootstrap plan.** Approved: one big offline backfill on `e`
  (EC2 remote), then deploy cascade — the worker catches up any
  minutes-of-drift between backfill-end and worker-start.
  1. On `e`, `awair pyramid backfill -F` (all 4 devices × 7 tiers ×
     covering periods, `--force` to rebuild the current-month shards).
     Writes go straight to R2 via the existing `r2://awair` output base.
     Estimate 15-30 min wall-clock.
  2. Apply D1 migration (`0001_shard_index.sql`) + seed
     `pyramid_watermarks` by walking R2 after the backfill: for every
     shard the backfill wrote, insert one row via a one-shot
     `awair pyramid seed-index --db awair-cascade` CLI (or directly via
     `wrangler d1 execute` if simpler).
  3. Deploy cascade with cron enabled. First tick converges any drift
     since backfill ended — small (single-digit minutes of raw
     accumulating into m5, then m30 downstream on the following tick).
  4. Smoke: `curl 'https://awair-serve.ryan-0dc.workers.dev/q?from=…&to=…&device_id=17617&bin_budget=250'`
     → should now return records at m30 tier for a current range.
     Open `?x=4px` in the browser and confirm the empty-state panel
     no longer fires.

## Non-goals

- Migrating to CFW ingest (retiring the Lambda). Nice-to-have — unified
  stack — but not blocking; Lambda's per-minute Awair API cadence works
  fine.
- Unified shard-duration ladder (multiple rungs per tier). Overkill for 4
  devices; can adopt later if we ever need sub-hour resolution history.
