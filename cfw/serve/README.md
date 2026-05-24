# `awair-serve`

Cloudflare Worker serving pyrmts pyramid queries for awair sensor data.

```
www chart  →  GET /q?from=…&to=…&device_id=…&bin_budget=…
                      │
              awair-serve  ──→  R2 bucket `awair`  (pyramid/awair-<id>/<tier>/<period>.parquet)
                      │
                      └──→  JSON: { records, plan }
```

Tier shards are pre-built offline via `awair pyramid build` (sibling Python
CLI). This worker is a thin reader: parses the query, picks the coarsest
tier that fits the bin budget, fetches the relevant shard rows, and stitches
them through the sum monoid.

## Offline smoke test

Validates the full read path (planner → fetch → stitch) against pyramid
shards on local disk — no R2, no wrangler, no Cloudflare account.

```bash
# 1. Build some shards locally (sibling Python CLI)
cd ../..
awair pyramid build -t raw -p 2026-05 -i 17617
awair pyramid build -t h1  -p 2026-05 -i 17617
awair pyramid build -t d1  -p 2026    -i 17617
awair pyramid build -t mo1 -p 2026    -i 17617

# 2. Run the smoke test
cd cfw/serve
pnpm install
pnpm smoke
```

The script exercises a range of `binBudget` values to show the planner
picking different tiers (raw for ~50k bins, mo1 for ~10).

## Deploy

```bash
# One-time
pnpm wrangler r2 bucket create awair        # already done — bucket exists

# Each deploy
pnpm install
pnpm deploy

# Smoke test against deployed
curl 'https://awair-serve.<your-subdomain>.workers.dev/health'
curl 'https://awair-serve.<your-subdomain>.workers.dev/q?from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z&device_id=17617&bin_budget=30'
```

## Pyramid config

The pyramid shape is defined in `../../pyramid.yml` at the awair repo root,
bundled into the worker as raw text via wrangler's `Text` rule. Edits to
that file require a re-deploy of the worker; the Python builder reads the
same file at build time.

## Pyrmts dependency

Currently linked locally:

```json
"pyrmts": "file:../../../pyrmts/js/packages/pyrmts",
"pyrmts-cfw": "file:../../../pyrmts/js/packages/pyrmts-cfw"
```

Once `pyrmts` ships a `dist-*` branch (per
`~/c/pyrmts/specs/multi-scale-ts-library.md`), switch to `pds gh pyrmts`.
