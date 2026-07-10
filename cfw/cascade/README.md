# `cfw/cascade`

Cloudflare Worker that maintains awair's pyrmts tier shards via
`pyrmts` gap discovery + `converge()`. Runs every minute; each tick
diffs pyramid.yml's expected shards against what D1 says has been
written, and writes whatever's missing until it hits a 25 s wall-clock
budget.

Companion to:

- `cfw/serve/` — reads shards, serves `GET /q`.
- `cfw/monitor/` — HEADs raw shards, sends Pushover alerts on freshness gaps.
- Lambda ×4 devices — the only writer of the `raw` tier; cascade skips
  `raw` on purpose.

Spec: `specs/cfw-cascade.md`.

## Endpoints

- `GET /health` — returns `{ok: true, worker: 'awair-cascade'}` (Phase 2
  will replace with a full HealthSnapshot).
- `GET /converge?devices=&tiers=&dryRun=1` — manual trigger. Secret-gated
  via `?key=` (from `wrangler secret put MANUAL_KEY`).

## Deploy (one-time setup)

Prereq: `wrangler login` with a CF Paid account (needed for 1000
subrequests/invocation, which cascade catch-up can hit).

```bash
cd cfw/cascade
pnpm install

# 1. Create D1 database.
pnpm wrangler d1 create awair-cascade
# → copy the printed database_id into wrangler.toml (both prod + [env.dev])

# 2. Apply migrations (creates pyramid_watermarks + pyramid_shards).
pnpm run d1:apply:remote

# 3. Set MANUAL_KEY secret (gates /converge to prevent unauthenticated writes).
pnpm wrangler secret put MANUAL_KEY

# 4. Deploy.
pnpm run deploy
```

## Bootstrap (fill upper tiers for the first time)

The R2 pyramid currently has ~40 days of missing upper-tier shards
(m5/m30/h3/d1/d7/mo1 for 2026-06 and 2026-07). Cascade could self-heal
from scratch, but doing the initial catch-up via the Python CLI on `e`
is faster: no per-tick 25 s budget, ~15-30 min wall-clock total.

On `e` (or wherever `awair` CLI + AWS/R2 creds live):

```bash
# Rebuild every device × tier × period from scratch. --force overwrites
# existing shards (so if a stale current-month shard is present, it gets
# rebuilt from fresh raw).
awair pyramid backfill -F -o r2://awair

# ~15-30 min wall-clock. Progress prints per shard.
```

Then seed D1 with what the backfill wrote. Two options:

- **A. Direct SQL from R2 inventory.** Ask R2 for the list of keys, emit
  one `INSERT` per key. Simple; can copy-paste into
  `wrangler d1 execute`.

- **B. Let cascade discover.** Deploy cascade with an empty D1
  `pyramid_shards` table and let the first `convergeAll` tick discover
  every shard as "missing" — the write path is idempotent (re-writes
  are byte-equivalent) but wasteful (rewrites everything). Not
  recommended for the initial bootstrap.

Sticking with A. Post-backfill, on `e`:

```bash
# Emits INSERT statements to stdout, one per R2 key.
awair pyramid seed-index --pyramid-name awair --out /tmp/seed-index.sql
```

(This CLI is a follow-up task — until it lands, seed via a small
one-shot script that walks R2 and writes `INSERT`s.)

Then, locally with wrangler auth:

```bash
pnpm wrangler d1 execute awair-cascade --remote --file /tmp/seed-index.sql
```

Cascade's next tick will see nothing missing and be a quiet no-op.

## Smoke test

```bash
# 1. Test the /health endpoint.
curl 'https://awair-cascade.<subdomain>.workers.dev/health'
# → {"ok":true,"worker":"awair-cascade"}

# 2. Dry-run a converge — should show 0 missing after bootstrap.
curl 'https://awair-cascade.<subdomain>.workers.dev/converge?dryRun=1&key=<MANUAL_KEY>' | jq

# 3. Verify FE at ?x=4px on air.rbw.sh no longer hits the empty-state
#    panel (added in `d9400fe`). The chart should render at m5 tier now.
open 'https://air.rbw.sh/?x=4px&d=+desk+br+rt&y=tcaA&s=2h&t=-1d'
```

## Adding / renaming / deactivating a device

Devices live in the D1 `devices` table (Phase 1b). Refresh flow:

```bash
# 1. Refresh the S3 parquet cache from Awair's API (rate-limited by upstream).
awair api devices --refresh

# 2. Regenerate + apply the D1 seed. Idempotent UPSERTs; safe to re-run.
awair pyramid seed-devices | pnpm -C cfw/cascade wrangler d1 execute awair-cascade --remote --file -
```

Cascade picks up the new device on the next cron tick; FE picks it up on the next `useDevices` refetch (1 h stale-time, force with a page reload).

## Dev environment

`wrangler.toml` declares `[env.dev]` for iteration without touching prod
cron. It shares the same R2 bucket + D1 database but writes rows to
D1 under `pyramid = 'awair-dev'` so prod's watermark grid is unaffected.

```bash
# Local iterate. Test the cron with --test-scheduled or hit /converge:
pnpm wrangler dev --env dev --remote
curl 'http://localhost:8787/converge?dryRun=1'
```

## Tail logs

```bash
pnpm run tail
```
