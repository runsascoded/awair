/**
 * Backfill the D1 `pyramid_shards.footer_bytes` cache for shards that
 * predate migration `0004_footer_cache.sql`, or that Lambda writes (raw
 * tier — cascade doesn't own those writes).
 *
 * Called via `GET /backfill-cache` (secret-gated via `MANUAL_KEY`). One
 * pass through D1 finds all shards with `footer_bytes IS NULL`, does an
 * R2 `head + get(range)` per shard, and UPDATEs D1 with the last 64 KiB.
 *
 * Cost: bounded by the sum of `min(shard_size, 64KiB)` fetched from R2
 * per invocation. Runs inside a 25s wall-clock budget so a large fleet
 * gets caught up over multiple invocations.
 */

interface ShardRow {
  pyramid: string
  tier: string
  shard_dur: string
  period_start: number
  key: string
}

export interface BackfillReport {
  total: number
  backfilled: number
  skipped: number
  errors: number
  elapsedMs: number
  stoppedReason?: 'budget'
  perDevice?: Record<string, number>
}

const FOOTER_CACHE_SIZE = 64 * 1024

export async function backfillFooterCache(
  env: { PYRAMID: R2Bucket; DB: D1Database },
  opts: { totalBudgetMs?: number; limit?: number } = {},
): Promise<BackfillReport> {
  const started = Date.now()
  const totalBudgetMs = opts.totalBudgetMs ?? 25_000

  const limit = opts.limit ?? 200
  const { results } = await env.DB.prepare(
    `SELECT pyramid, tier, shard_dur, period_start, key
     FROM pyramid_shards
     WHERE footer_bytes IS NULL
     ORDER BY tier, pyramid, period_start
     LIMIT ?`,
  ).bind(limit).all<ShardRow>()

  const rows = (results ?? []) as ShardRow[]
  let backfilled = 0
  let skipped = 0
  let errors = 0
  const perDevice: Record<string, number> = {}
  let stopped: 'budget' | undefined

  for (const r of rows) {
    if (Date.now() - started >= totalBudgetMs) { stopped = 'budget'; break }
    try {
      const head = await env.PYRAMID.head(r.key)
      if (head === null) {
        // Shard registered in D1 but missing from R2 — skip. This can
        // happen if R2 was wiped without also wiping D1.
        skipped++
        continue
      }
      const size = head.size
      const start = Math.max(0, size - FOOTER_CACHE_SIZE)
      const obj = await env.PYRAMID.get(r.key, { range: { offset: start, length: size - start } })
      if (obj === null) { skipped++; continue }
      const footer = new Uint8Array(await obj.arrayBuffer())
      await env.DB.prepare(
        `UPDATE pyramid_shards
           SET size_bytes = COALESCE(size_bytes, ?),
               footer_bytes = ?
         WHERE pyramid = ? AND tier = ? AND shard_dur = ? AND period_start = ?`,
      ).bind(size, footer, r.pyramid, r.tier, r.shard_dur, r.period_start).run()
      backfilled++
      perDevice[r.pyramid] = (perDevice[r.pyramid] ?? 0) + 1
    } catch {
      errors++
    }
  }

  return {
    total: rows.length,
    backfilled,
    skipped,
    errors,
    elapsedMs: Date.now() - started,
    perDevice: Object.keys(perDevice).length > 0 ? perDevice : undefined,
    ...(stopped !== undefined ? { stoppedReason: stopped } : {}),
  }
}
