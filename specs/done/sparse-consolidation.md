# Source-confirmed sparse consolidation

Approved approach: distinguish missing processing from confirmed missing measurements. Closed rollups must contain every available measurement, with no invented values for outages.

## Behavior

- Before building a missing or invalidated `raw/1mo` shard, cascade reads the authoritative closed S3 month from `{RAW_SOURCE_ROOT}/awair-{device_id}/{YYYY-MM}.parquet`. The root defaults to `https://380nwk.s3.amazonaws.com`.
- A valid source month produces all daily raw tiles from the device's genesis through month-end. A fully empty day is a valid zero-row Parquet file. Missing minute bins have no stored rows; they are not zero readings or literal null rows.
- Source HTTP errors, 404s, invalid schemas, and incomplete writes never establish emptiness or completion. Current open months remain Lambda-owned and are not reconciled.
- Monthly consolidation retains its complete-input gate. Cross-tier writes also require all expected source objects before writing, including valid zero-row objects. Missing or stale expected inputs are blocked until rebuilt and registered, even when an old body still exists in R2. A fully empty result is itself a valid zero-row shard.
- Reconciliation invalidates downstream shards before the first daily write and again after all daily writes. Completion evidence is published last, so a partial failure can be retried without certifying incomplete work.
- Each reconciled month has a versioned source snapshot under `raw/_sources/YYYY-MM.json`, containing source URL, ETag, reconciliation time, row count, and gaps of at least five missing minute bins. It is separate from the shard inventory.
- Each normal cascade tick conditionally rechecks one reconciled source per device, rotating monthly snapshots. An ETag change rebuilds daily tiles and invalidates overlapping rollups. Missing monthly output forces reconciliation even if the previous ETag matches, repairing deleted daily inputs too. Dry runs do not audit or write sources.
- `/health` exposes source-confirmed `dataGaps` per device, merging adjoining month fragments. The dashboard shows these as purple, hatched vertical bands across every tier and lists exact timestamps and durations below the timeline. The bands mark missing source readings; coarser bins overlapping the edges can still contain readings from outside the outage. Shard bars remain processing indicators: green means built, including sparse shards. Unmarked regions do not claim uninterrupted availability. Existing chart gap handling renders absent bins as breaks; its null separators are a rendering detail.

## Scope and costs

This adds one source conditional GET per audited device/tick and daily R2 HEADs/writes when reconciling a changed month. Only months that have been reconciled are audited and report confirmed gaps; an existing historical monthly shard does not by itself create source evidence. HTTP 404 leaves the month unresolved, rather than treating the entire month as empty.

Closed S3 sources are fetched and validated before any daily writes, with a 16 MiB input cap and the existing cascade time budget. Daily objects from closed months may be replaced to reflect S3 repairs; the open month remains untouched. No Parquet measurement schema or D1 migration is needed, and the health field is additive.

Daily HEAD checks and monthly input reads are batched independently, bounded by the calendar month's 31 daily tiles. Production R2 latency made serial checks plus reads exceed the 25-second tick budget even after the daily repair completed. Writes and invalidation remain sequential, and the monthly writer checks its deadline again after the input batch. The latency regression reproduces failure with serial reads and passes with batching.

## Validation

Cascade tests exercise empty days, sparse monthly output, all-empty downstream output, refusal of unknown inputs, source failures, conditional rechecks, deleted-day repair, changed-source repair, and retry after a partial write. The public BR September 2026 source contains 39,710 readings in 39,707 minute bins; the confirmed missing-bin interval is September 21 21:33 UTC through September 23 19:33 UTC, exactly 46 hours. September 22 has no rows in either raw or three-minute rollups.

Production rollout and rebuilding are complete as of 2026-10-13 02:35 UTC. The consolidation/UI fix is committed in `3ff3c32`, with the production latency adjustment in `089d380`. The separate `use-prms` bump is `befe629`. Both pushed code changes passed GitHub CI; the dashboard's Pages deployment passed its build, lint, and E2E checks.

Deployed Worker versions: serve `536981e5-3b86-48bf-8674-00de6ede42c6`, cascade `e989a068-3b01-4c24-adf9-417774ccad07`. The normal production cron repaired September daily tiles and rebuilt the affected monthly/32-day/128-day rollups across the shared four-device invalidation journal. The final tick pruned 65 spent invalidations, leaving zero. All four devices report complete processing coverage and zero missing shards.

Downloaded rebuilt BR production artifacts were compared with the original S3 source. Every tier preserves exactly 39,710 September CO₂ readings; all metric counts match per bin, and per-bin sums/squared sums match within floating-point tolerance. September bin counts are raw 39,707; m3 13,324; m10 4,000; m30 1,335; h2 336; h6 113; d1 29. September 22 has no rows at every tier. The real `/q` daily query for the month plans the rebuilt `d1/128d/2026-06-04` shard and returns 29 populated days, with September 22 absent.

Production CIC verified [health] and [the BR outage chart]: the health page shows green processing bars with vertical purple source-gap bands and a 46-hour gap entry; the chart preserves the break. BR has four smaller confirmed September gaps as well. Only reconciled months have source evidence; unmarked historical intervals remain unchecked. The cascade's 26 unit tests plus the one-off production artifact audit passed (27 checks total).

An audit of existing production artifacts found that the unregistered BR `m10/32d/2026-09-08` body contains only October 1–9. The registered `m30`, `h2`, `h6`, and `d1` `128d/2026-06-04` consumers all contain just 9,791 September CO₂ readings (September 1–7) versus 39,710 in S3. The old cross-tier writer persisted partial bodies before the registration gate; consumers could then mistake those bodies for complete inputs. Consequently, those old coarse shards omit September 8–30, beyond the real source outage. Reconciliation must rebuild downstream shards too. The per-tick unavailable-input set now prevents propagation through missing/stale expected inputs, including previously persisted bodies. The regression test fails without the guard and passes with it.

[health]: https://air.rbw.sh/health
[the BR outage chart]: https://air.rbw.sh/?d=br&y=thaA&t=260924-4d
