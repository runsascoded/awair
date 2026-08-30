# Adopt `pyrmts-ops d1 verify`; awair's D1 is missing `pyramid_shards_period`

Source: pyrmts session, 2026-08-28. Written after pyrmts landed a schema emit/verify/apply layer (`pyrmts/specs/d1-schema-drift.md`) — awair is one of the two consumers whose hand-maintained copy of the DDL motivated it.

## The immediate finding

`cfw/cascade/migrations/0001_shard_index.sql` (2026-07-09) transcribes `D1ShardIndex.schemaSql()` and says so in its own header:

> Schema copied verbatim from `pyrmts-cfw` `D1ShardIndex.schemaSql()` … Keeping the statements identical avoids drift with pyrmts library assumptions — **update this file if that method's output changes**.

That method's output changed on 2026-08-28: it now also emits

```sql
CREATE INDEX IF NOT EXISTS "pyramid_shards_period" ON "pyramid_shards" (pyramid, period_end);
```

so **`awair-cascade`'s D1 does not have it.** The index exists because a windowed `listShards` (`{ range }`, no `tier` pinned) can't seek on the `(pyramid, tier, shard_dur, period_start)` PK and scans the whole pyramid partition — O(shards) rows read per call. ctbk measured 14,561 rows read to return 17 on a 1-hour window, and ~all of their D1 read volume was that one query shape; after the index, 22. Whether awair is paying materially depends on whether anything calls `listShards` with a range per request (ctbk's serving path does; check `cfw/cascade` and `cfw/serve`) — but the index is cheap, the write cost is one extra row-write per `recordShard`, and being a schema version behind is worth closing regardless.

## What to do

1. **Apply the index.** It is `IF NOT EXISTS`, so this is safe and re-runnable:
   ```bash
   pyrmts-ops d1 schema > cfw/cascade/migrations/0005_pyrmts_period_index.sql   # or copy the one statement
   npx wrangler d1 migrations apply awair-cascade --remote
   ```
   Emitting the whole schema is fine — the two `CREATE TABLE`s are no-ops against your existing database. If you'd rather keep the migration minimal, the single `CREATE INDEX` above is the only new statement.
2. **Replace the transcription warning with a check.** `pyrmts-ops d1 verify` diffs the live database against what the library expects (read-only; `sqlite_master` + `PRAGMA table_info`/`index_info`), prints `schema up to date` or e.g. `missing: pyramid_shards_period`, and **exits 1 on drift** — so it works as a CI step or a pre-deploy gate. `-j/--json` gives `{ok, missing, mismatched}`. Env is the one `pyrmts.d1` already uses: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `D1_DATABASE_ID`.
   Once that runs somewhere, `0001_shard_index.sql`'s header can drop the "update this file" instruction and point here instead — the file stays as the applied-migration record, but nothing depends on a human noticing any more.
3. **Optional, TS side:** `D1ShardIndex.verifySchema(env.DB)` returns `{ok, missing, mismatched}` and is cheap enough to include in a health/monitor payload if you'd rather see drift reported than gated.

Keep owning the numbering — pyrmts deliberately doesn't. Your own tables (`devices`, `shard_stats`, `footer_cache`) interleave with pyrmts' in the same sequence, and that's the intended shape.

## Notes

- `pyrmts-ops` is a new console script (this is the package's first CLI); it needs `pyrmts-ops` installed, i.e. a Python pin past the commit below.
- pyrmts commit: `bb1af9b`. **Not yet pushed** — pyrmts holds `main` until a consumer validates on a local link/editable install, so if awair wants to be that validator, install editable from `~/c/pyrmts/python` and report back; otherwise ctbk will validate and awair can pin the pushed SHA afterward.

## Implementation status (2026-08-30, awair session)

- **`0005_pyrmts_period_index.sql` written** — the single `CREATE INDEX IF NOT EXISTS` statement, verbatim from `D1ShardIndex.schemaObjects()`.
- **`0001_shard_index.sql` header updated** — the "update this file if that method's output changes" instruction is replaced by a pointer to `pyrmts-ops d1 verify` / `D1ShardIndex.verifySchema()`, per step 2.
- **Confirmed awair is on the query shape that pays for it**: `cfw/serve/src/index.ts`'s `RawTipShardIndex.listShards` forwards a `{ range }` filter (the `/q` path), pinning neither `tier` nor `shard_dur`.
- **Applied to the live database (2026-08-30).** A scoped `awair-d1-rw` token (D1 Write, RAC account only) in `.envrc` as `CLOUDFLARE_API_TOKEN` flips wrangler off its cached OA OAuth; `d1 migrations apply --remote` recorded `0005` and created the index. Verified: `sqlite_master` shows `pyramid_shards_period` on `pyramid_shards`, and `PRAGMA index_info` gives `(pyramid, period_end)` in that order — matching `D1ShardIndex.schemaObjects()`.
- **`bb1af9b` is pushed** (contained in `r/main`; pyrmts' held-commit gate was discharged) — the spec's "not yet pushed" caveat is stale, so awair can pin a real SHA whenever it wants `pyrmts-ops`.
- **Step 2's CI gate is not wired.** `pyrmts-ops d1 verify` needs `CLOUDFLARE_API_TOKEN` + `D1_DATABASE_ID` as repo secrets; awair's workflows have neither today. Open question for the user, not blocked on code.
- **Step 3 (`verifySchema` in the health payload) not done**: awair's JS pins are `pyrmts@54cbdc9`, which predates the method. Needs a pin bump.
