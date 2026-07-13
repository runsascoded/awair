-- Per-shard parquet-footer cache.
--
-- `footer_bytes` is the last 64 KiB of the shard file — matches pyrmts'
-- `DEFAULT_INITIAL_FETCH_SIZE` (see `pyrmts/src/fetch.ts:10`). Serving
-- this from D1 lets `cfw/serve /q` skip the fixed 64 KiB metadata-tail
-- fetch pyrmts issues per shard touched. Empirically ~48 % of query bytes
-- and latency (`/q?debug=1` rollups).
--
-- Invalidation: keyed by `(pyramid, tier, shard_dur, period_start)`;
-- `size_bytes` is checked at read time against the R2 file's actual size.
-- Mismatch → cache passthrough (file grew, most commonly the current-tail
-- raw shard). Cascade rewrites populate the cache on next write.

ALTER TABLE pyramid_shards ADD COLUMN footer_bytes BLOB;
