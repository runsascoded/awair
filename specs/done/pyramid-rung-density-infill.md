# Pyramid rung-density infill (2026-08-31)

Infill the per-tier shard ladders in `src/awair/pyramid.yml` so every rung step is ≤4× (matching the config's own stated invariant, which several tiers were violating with 8× jumps). Motivated by the shard/cover analysis in the 2026-08-30/31 session (root-causing the intermittent mobile "No data" transient).

Status: **DEPLOYED + verified 2026-08-31.** serve `cf65d8f2` + cascade `fd6b8bb9`, both on pyrmts dist `e75c857` (= main `c29d428`, bundles pyrmts-cfw). This is primarily an awair `pyramid.yml` change; pyrmts is CC'd because it (a) validated the "infill = pure config edit" maturity property (zero engine change — gap-discovery picked up the new rungs on the next tick) and (b) owns the deploy-pin the change wanted.

Verification: real `validateLadders` passed; typecheck clean both workers; cascade vitest 13/13; a coarse-budget 7d `/q` returns non-null `outputTier=m30` for all 4 devices; cascade built the new rungs within one tick (h2/h6 `64d`, m3/m10/m30 `16d`) at `outcome: ok`, cpuTime 196ms / wall 20s (far under 30s CPU limit); backfill burst drained to quiet ticks; `/events` clean. **No perf issue materialized.**

## Motivation

The min-cover planner tiles a query's range using the coarsest EXISTING shards per sub-period, then bridges the open tail by cascading down through finer rungs/tiers. The intermittent mobile bug is a transient D1 `listShards` returning an incomplete inventory → over-budget raw-only fallback → empty plan (`outputTier` absent) → FE "No data". The real fix is server-side in pyrmts (consistent read / retry / 5xx-on-partial). **This change does not fix that transient** — it shrinks the open-tail bridging *surface* (fewer segments/keys per query), which reduces exposure, and is a worthwhile efficiency/freshness win on its own.

## The finding: ladders don't (and can't fully) hold rows-per-shard constant

Rows/shard = shard ÷ bin, for the *pre-infill* ladders:

| tier | bin   | shards (rows/shard)              | min | max   |
|------|-------|----------------------------------|-----|-------|
| raw  | 1min  | 1d=1440, 1mo=43200               | 1440| 43200 |
| m3   | 3min  | 1d=480, 4d=1920, 32d=15360       | 480 | 15360 |
| m10  | 10min | 1d=144, 4d=576, 32d=4608         | 144 | 4608  |
| m30  | 30min | 4d=192, 32d=1536, 128d=6144      | 192 | 6144  |
| h2   | 2h    | 16d=192, 128d=1536, 512d=6144    | 192 | 6144  |
| h6   | 6h    | 16d=64, 128d=512, 512d=2048      | 64  | 2048  |
| d1   | 1d    | 32d=32, 128d=128, 512d=512       | 32  | 512   |

Max-rung rows span 512 → 43,200 (84×); the *mid* tiers (m10/m30/h2) already cluster ~5–6k. The outliers:
- **too fat**: raw 1mo (43,200), m3 32d (15,360)
- **too thin**: h6 512d (2,048), d1 512d (**512**)

The thin ones **cannot be fattened**: d1 is 1 row/day, so a 5k-row shard needs a ~14-year duration; h6 needs ~3.4y. Coarse tiers are row-starved by construction — "constant rows/shard" is a *fine-tier* heuristic only. So the two instincts from the session conflict at the coarse end (constant-rows wants *larger* smallest shards there; freshness wants *smaller*); freshness wins by default because fattening is hopeless anyway. That freshness lever (smaller smallest coarse rung) is deferred — see Follow-ons.

## The change: fill the 8× jumps (maxes unchanged)

pyrmts's `validateLadders` enforces ascending + divisibility-chained + no-dups + smallest ≥ bin, **but not ≤4×** — which is why the 8× jumps passed. Every step is now 2×/4×:

| tier | before             | after                    | note                          |
|------|--------------------|--------------------------|-------------------------------|
| raw  | [1d, 1mo]          | [1d, 1mo]                | unchanged (deliberate 30× calendar archival jump) |
| m3   | [1d, 4d, 32d]      | [1d, 4d, **16d**, 32d]   | 4d→32d was 8×                 |
| m10  | [1d, 4d, 32d]      | [1d, 4d, **16d**, 32d]   | 4d→32d was 8×                 |
| m30  | [4d, 32d, 128d]    | [4d, **16d**, 32d, 128d] | 4d→32d was 8×                 |
| h2   | [16d, 128d, 512d]  | [16d, **64d**, 128d, 512d] | 16d→128d was 8×             |
| h6   | [16d, 128d, 512d]  | [16d, **64d**, 128d, 512d] | 16d→128d was 8×             |
| d1   | [32d, 128d, 512d]  | [32d, 128d, 512d]        | already ≤4×                   |

**Max rung (`shards[-1]`) is identical for every tier**, so:
- the Python builder (`awair pyramid backfill`, writes only `max_shard`) produces byte-identical output — this is a **cascade-only** change;
- no history is invalidated or rebuilt.

## Why it's clean (validation done)

- Python `load_config` parses it; `previous_tier` (cross-tier bin-divisibility source selection) resolves unchanged (raw←m3/m10, m10←m30, m30←h2, h2←h6, h6←d1).
- Real pyrmts `validateLadders` (main `c29d428`) passes all 7 ladders.
- gap-discovery reads `tier.shards` dynamically and materializes intermediate rungs **only within the current open max-shard period's trailing tail** (greedy largest-fitting-rung descent over `shards.slice(0,-1)`); closed history stays single-max-shard. So the infill needs **zero pyrmts code** — it's a pure config edit. This is the "easy to infill tier/rung density" maturity property in action.
- `tileFromExisting` tiles a coarse-rung gap greedily largest-first from existing finer rungs, so a present 16d shard lets 32d build from 2×16d instead of 8×4d — fewer reads/step, and the 16d closed shard becomes available to the serve for open-tail tiling.
- No test hardcodes the old ladders; awair pyramid/config tests + cascade vitest (13/13) pass.

## Effect

Scoped to the **open max-shard period tail** (where recent/mobile queries live — exactly where the transient bites). Example, m30 (max 128d): the open-128d tail was `[closed 32d][4d × up-to-7]` (the 8× gap left up to 28d covered only by 4d shards); now `[closed 32d][16d][4d × few]`. Fewer shards in the tail ⇒ fewer objects the serve tiles ⇒ smaller plans ⇒ less transient exposure. Deep history is unaffected (already one max shard, already efficient).

## Perf / CFW-resource analysis

No concern. Against paid/bundled Workers limits:
- **Subrequests (1000/invocation):** each consolidation is now ≤4 reads + 1 write ≈ 5; even building many per tick leaves ~200-consolidation headroom.
- **CPU (30s/invocation):** cascade self-caps at `TOTAL_BUDGET_MS=25000`; unchanged.
- **R2 objects (steady state):** intermediate rungs exist only transiently within an open max-period, then collapse to the max shard on close. Bounded by rungs-in-one-open-period per device (a handful of 16d + up-to-~8 64d), not by history. ~negligible extra objects + storage (few KB–low-100s KB each).
- **Backfill burst (one-time):** building intermediate rungs for the current open windows over existing history — bounded, absorbed by the existing per-tick rolling budget (order minutes of busier ticks, then back to quiet ticks). No rebuild of closed history.
- **D1 inventory rows:** +O(rungs in open windows) per device; negligible.

If a future denser change (e.g. halving SUF, or the coarse-tier freshness follow-on at scale) ever *did* approach limits, options: raise the CPU limit (paid Workers config), split convergeAll across more ticks (already budget-rolled), or shard the cron by device/tier. Not needed here.

## Deploy coordination

1. Land this `pyramid.yml` edit (done in working tree).
2. **Bump the pyrmts pins to current main** (`c29d428`+) for BOTH `cfw/serve` and `cfw/cascade` (currently `55825c1`, ~7 behind) so the deployed serve understands the new rungs and cascade has the current trailing-rung-descent gap-discovery. (The deployed serve pin `54cbdc9` is further behind — see the 2026-08-30 staleness notes.)
3. Deploy cascade (re-bundles the YAML as text) then serve.
4. Watch: cascade quiet-tick logs recover after the short backfill burst; `/events` stays clean; a coarse-budget 7d `/q` returns a non-null `outputTier`.

## Follow-ons (not in this change)

- **Coarse-tier freshness** (the deferred second instinct): add a smaller smallest rung to row-starved tiers, e.g. d1 `[8d, 32d, 128d, 512d]`, to shrink the open tail the serve bridges from finer tiers on *long-range* (months/years) queries. Payoff is long-range, not the mobile 7d case; tiny files, but coarse files are tiny regardless.
- **Tier density**: SUF is already 3–4× (1→3→10→30min→2h→6h→1d); no tier infill warranted now. Halving to ~2× would fit bin budgets tighter (less over-aggregation) at the cost of ~2× tiers/storage/cascade work — a separate call.
- **raw `[1d, 1mo]`**: the one intentional non-≤4× pair (bounded Lambda tip R/W + calendar-monthly archival). Optionally add a `4d` rung to bound open-month raw object count (~30 → ~8), but the min-cover planner only reads raw for today's sliver, so low value.

## pyrmts note

This exercised the config-only infill path cleanly (no engine change). One rough edge worth a pyrmts issue: `validateLadders` enforces divisibility but not the ≤4× smoothness the docs assume — a **warn-level lint** (not error) flagging >4× rung steps would have caught the original 8× jumps at author time. (raw's calendar jump would need an opt-out annotation.)
