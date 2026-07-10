-- Devices table — canonical source of the device list + per-device
-- genesis timestamp for pyrmts range clipping. Replaces the Phase-1a
-- hardcoded `DEVICES[]` array in `cfw/cascade/src/devices.ts` and the
-- FE's direct fetch of `s3://380nwk/devices.parquet`.
--
-- Refreshed by `awair api devices --refresh` (dual-writes to S3 parquet
-- for backwards-compat during the transition — that side will be
-- retired later). Cascade reads at startup of each converge tick; FE
-- reads via `cfw/serve /devices`.
--
-- `genesis_ts`: milliseconds since epoch. First-of-month UTC of the
-- device's earliest raw shard (cheap approx — a few pre-genesis-day
-- tiles for the earliest month, negligible cost).
--
-- `active`: 0/1. FE + cascade filter to `active=1` by default.

CREATE TABLE IF NOT EXISTS "devices" (
  device_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  genesis_ts INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_refreshed_at INTEGER NOT NULL
) WITHOUT ROWID;
