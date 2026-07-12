-- Per-shard statistics on `pyramid_shards`. Populated by cascade at
-- write time (cascade.ts `recordShardStats`) and by
-- `awair pyramid stats-backfill` for shards that predate this
-- migration or were written by Lambda (raw tier — cascade doesn't own
-- raw writes).
--
-- Columns are nullable during the transition: FE code renders `—`
-- for null values. After a full `stats-backfill` run, all rows should
-- have values.

ALTER TABLE pyramid_shards ADD COLUMN size_bytes INTEGER;
ALTER TABLE pyramid_shards ADD COLUMN n_rows INTEGER;
ALTER TABLE pyramid_shards ADD COLUMN n_rgs INTEGER;
-- JSON array of per-RG row counts, e.g. `[10200, 10200, 3600]`. Small
-- (< 200 bytes even for many RGs), so no separate table needed. NULL
-- means unknown; empty array `[]` would mean "known to be no data".
ALTER TABLE pyramid_shards ADD COLUMN rg_row_counts TEXT;
