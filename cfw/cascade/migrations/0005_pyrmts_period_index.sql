-- Secondary index `pyrmts-cfw` `D1ShardIndex` gained on 2026-08-28, after
-- this database was provisioned. Emitted by `D1ShardIndex.schemaSql()`;
-- `pyrmts-ops d1 verify` is what notices the gap (see `0001_shard_index.sql`).
--
-- `pyramid_shards`' PK is `(pyramid, tier, shard_dur, period_start)`. A
-- windowed `listShards` — `cfw/serve`'s `/q` path, via `RawTipShardIndex`
-- — filters on `period_end`/`period_start` while pinning neither `tier`
-- nor `shard_dur`, so the PK can only seek on `pyramid`: every shard in
-- the pyramid is read and filtered in memory. pyrmts measured 857x
-- amplification at 14.5K shards (`shard-index.ts`); awair's pyramids are
-- far smaller, but the fix costs one extra row-write per `recordShard`.

CREATE INDEX IF NOT EXISTS "pyramid_shards_period" ON "pyramid_shards" (pyramid, period_end);
