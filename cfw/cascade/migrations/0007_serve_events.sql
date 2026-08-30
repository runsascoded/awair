-- Durable telemetry for the serve worker's empty-plan transient (and
-- genuine HTTP errors). The failure mode is a silent HTTP 200 with an
-- empty plan (`tier=None`) — a transient incomplete D1 `listShards` read —
-- so it never surfaces as a logged error; Workers Logs (3-day retention)
-- only show a 200. This table is the queryable, long-lived record of how
-- often it actually happens.
--
-- Two writers (see `cfw/cascade/src/events.ts`):
--   probe_empty   — the cascade `serve-empty` health probe hit `tier=None`
--                   (synthetic ~1/min baseline, independent of user traffic)
--   client_empty  — a real FE fetch hit the transient; `attempts` +
--                   `recovered` record how the in-fetch retry fared
--   client_error  — a real FE fetch got a non-2xx (`status`) / threw
--
-- Rows are anomalies only (we do NOT log the healthy majority), so the
-- table stays small; count-by-day/kind gives the flakiness rate.

CREATE TABLE IF NOT EXISTS "serve_events" (
  id         INTEGER PRIMARY KEY,
  ts         INTEGER NOT NULL,   -- ms-epoch the event was recorded
  kind       TEXT NOT NULL,      -- probe_empty | client_empty | client_error
  device_id  INTEGER,
  bin_budget INTEGER,
  range_from INTEGER,            -- ms-epoch
  range_to   INTEGER,            -- ms-epoch
  smooth     TEXT,               -- `?smooth=` value, when set
  status     INTEGER,            -- HTTP status (client_error)
  attempts   INTEGER,            -- retry attempts made (client_empty)
  recovered  INTEGER,            -- 0/1 whether a retry recovered (client_empty)
  detail     TEXT
);

CREATE INDEX IF NOT EXISTS "serve_events_ts" ON "serve_events" (ts);
CREATE INDEX IF NOT EXISTS "serve_events_kind_ts" ON "serve_events" (kind, ts);
