# `awair-monitor`

Cloudflare Worker that monitors per-device parquet freshness in S3 and sends Pushover alerts when a device goes stale.

## What it does

Every minute, for each of the 4 devices (Gym/BR/Desk/RT):

1. HEAD `s3://380nwk/awair-{id}/{YYYY-MM}.parquet` (current UTC month, falls back to previous month if 404).
2. Compute `staleMin = (now - Last-Modified) / 60s`.
3. Alert at tier crossings: **5 min**, **15 min**, **60 min**, then every additional **60 min**.
4. State per device kept in KV so we don't re-alert at the same tier.
5. When a previously-alerted device returns to <5 min stale, send one `✅ recovered after Xh Ym` Pushover.

Within the first 5 min of UTC midnight, a 404 on the current month is tolerated (the Lambda hasn't created the new month's file yet).

## One-time setup

```bash
cd cfw/monitor
pnpm install
pnpm wrangler login                     # browser auth
pnpm wrangler kv namespace create STATE
# → copy the printed namespace id into wrangler.toml ([[kv_namespaces]].id)

pnpm wrangler secret put PUSHOVER_TOKEN
pnpm wrangler secret put PUSHOVER_USER
pnpm wrangler secret put MANUAL_CHECK_KEY   # optional; gates /check + /test-pushover
```

## Deploy

```bash
pnpm deploy
```

## Smoke test

```bash
# Trigger a check via HTTP (omit ?key=... if MANUAL_CHECK_KEY isn't set)
curl 'https://awair-monitor.<your-subdomain>.workers.dev/check?key=...'

# Send a test Pushover
curl 'https://awair-monitor.<your-subdomain>.workers.dev/test-pushover?key=...'

# Stream live logs
pnpm tail
```

## Tweaking

- **Devices**: edit `[vars].DEVICES_JSON` in `wrangler.toml` (`[{"id": <int>, "name": "<str>"}, ...]`) and redeploy.
- **Tier thresholds**: edit `TIERS_MIN` / `HOURLY_AFTER_MIN` in `src/index.ts`.
- **Fresh threshold** (cooldown before recovery alert): `FRESH_THRESHOLD_MIN` in `src/index.ts`.
- **New-month grace window**: `NEW_MONTH_GRACE_MIN` in `src/index.ts`.

## State inspection

```bash
pnpm wrangler kv key list --namespace-id <KV_NS_ID>
pnpm wrangler kv key get --namespace-id <KV_NS_ID> 'device:17617'

# Reset a device (clears alert tier — next stale tier will alert again):
pnpm wrangler kv key delete --namespace-id <KV_NS_ID> 'device:17617'
```
