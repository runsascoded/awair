-- pyrmts `D1ShardIndex` schema. Two tables:
--
--   `pyramid_watermarks`: per-(pyramid, tier, shard_dur) — the latest
--     period_end recorded. Consulted by the planner to decide whether a
--     coarse tier is fresh through `to` or needs reaggregate from finer.
--   `pyramid_shards`: per-shard inventory. Enables gap discovery
--     (`listMissingShards`) — without this, converge() can't diff
--     expected-vs-recorded to know what to write next.
--
-- Schema copied verbatim from `pyrmts-cfw` `D1ShardIndex.schemaSql()` (see
-- `~/c/pyrmts/js/packages/pyrmts-cfw/src/shard-index.ts`). Keeping the
-- statements identical avoids drift with pyrmts library assumptions —
-- update this file if that method's output changes.

CREATE TABLE IF NOT EXISTS "pyramid_watermarks" (
  pyramid TEXT NOT NULL,
  tier TEXT NOT NULL,
  shard_dur TEXT NOT NULL,
  latest_period_end INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pyramid, tier, shard_dur)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS "pyramid_shards" (
  pyramid TEXT NOT NULL,
  tier TEXT NOT NULL,
  shard_dur TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  key TEXT NOT NULL,
  written_at INTEGER NOT NULL,
  PRIMARY KEY (pyramid, tier, shard_dur, period_start)
) WITHOUT ROWID;
