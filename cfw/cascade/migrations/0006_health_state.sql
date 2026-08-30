-- Per-check state for the cascade-hosted health monitor (`src/health.ts`,
-- `src/monitor.ts`). One row per check id (e.g. `raw-tip:17617`,
-- `cascade-lag:17617`, `serve-empty:17617`). The monitor runs each cron
-- tick and pages Pushover only on healthy↔unhealthy transitions; this
-- table is the dedup memory that makes a sustained outage page once
-- (down) and once (recovered) rather than every minute.
--
--   failing      1 while the check is currently failing, else 0
--   consecutive  consecutive failing ticks (0 when ok) — gates checks
--                that require a sustained streak before paging
--   alerted      1 once we've paged `down` for the current failing streak
--   since        ms-epoch the current failing streak began (NULL when ok)
--   detail       last human-readable status line (for the recovery page)

CREATE TABLE IF NOT EXISTS "health_state" (
  check_id    TEXT PRIMARY KEY,
  failing     INTEGER NOT NULL DEFAULT 0,
  consecutive INTEGER NOT NULL DEFAULT 0,
  alerted     INTEGER NOT NULL DEFAULT 0,
  since       INTEGER,
  detail      TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);
