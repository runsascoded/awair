// Parse the shared awair `pyramid.yml` (bundled by wrangler as raw text
// per the `rules` in `wrangler.toml`) once at module load. Config is
// immutable per deploy — no hot-reload path needed.

import { parsePyramidYaml, pyramidFromConfig, parquetBackend, type PyramidConfig, type Pyramid } from 'pyrmts'
import { r2Storage } from 'pyrmts-cfw'
import pyramidYamlText from '../../../src/awair/pyramid.yml'

export const PYRAMID_CONFIG: PyramidConfig = parsePyramidYaml(pyramidYamlText)

// pyrmts pyramid "name" prefix for D1 rows. Per-device names look like
// `awair-{device_id}` — separate namespaces per tenant because
// `ShardIndex`'s diffKey is `(tier, shardDur, periodStart)` without a
// device dim (see pyrmts `gap-discovery.ts::diffKey`). Sharing a name
// across devices would collapse all 4 devices' shards to a single row
// per (tier, shardDur, period) and upserts would clobber each other.
// The `dev` wrangler env overrides the prefix via `PYRAMID_NAME`.
export const DEFAULT_PYRAMID_NAME_PREFIX = 'awair'

export function pyramidNameFor(deviceId: number, prefix?: string): string {
  return `${prefix ?? DEFAULT_PYRAMID_NAME_PREFIX}-${deviceId}`
}

// The raw tier — Lambda's job, cascade skips it.
export const RAW_TIER = 'raw'

// Order pyramid.yml declares tiers.
export const TIER_ORDER: string[] = PYRAMID_CONFIG.tiers.map(t => t.name)

/** Fixed-width ms for a `Nmin`/`Nh`/`Nd` bin. Throws for `Nmo`/`Ny`
 *  (calendar-variable) — cascade sources are always fixed-width, and
 *  we need integer ms for the % divisibility check. */
function binMs(binSpec: string): number {
  const m = /^(\d+)(min|h|d)$/.exec(binSpec)
  if (m === null) throw new Error(`binMs: non-fixed-width bin '${binSpec}'`)
  const count = Number.parseInt(m[1]!, 10)
  const unitMs = { min: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'min' | 'h' | 'd']
  return count * unitMs
}

const TIER_BIN_MS: Record<string, number> = Object.fromEntries(
  PYRAMID_CONFIG.tiers.map(t => [t.name, binMs(t.bin)]),
)

/** For each target tier, the tier T' its cascade sources from — the
 *  largest T' with `bin(T') < bin(target)` AND `bin(target) % bin(T') == 0`.
 *  Bin-divisibility guarantees the target's floor-then-groupby rebin is
 *  exact — a source whose bin doesn't divide the target's would silently
 *  smear source buckets across neighboring target bins. Same rule
 *  ctbk's `SOURCE_TIER_FOR` uses. Returns null for the finest tier (raw
 *  — sourced from Lambda WAL, not another tier). */
const SOURCE_TIER_FOR: Record<string, string | null> = (() => {
  const out: Record<string, string | null> = {}
  for (let i = 0; i < TIER_ORDER.length; i++) {
    const target = TIER_ORDER[i]!
    if (i === 0) { out[target] = null; continue }
    const targetMs = TIER_BIN_MS[target]!
    let src: string | null = null
    let srcMs = 0
    for (let j = 0; j < i; j++) {
      const cand = TIER_ORDER[j]!
      const candMs = TIER_BIN_MS[cand]!
      if (candMs < targetMs && targetMs % candMs === 0 && candMs > srcMs) {
        src = cand; srcMs = candMs
      }
    }
    if (src === null) throw new Error(`no bin-divisible source tier for ${target}`)
    out[target] = src
  }
  return out
})()

export function sourceTierFor(tier: string): string | null {
  if (!(tier in SOURCE_TIER_FOR)) throw new Error(`unknown tier: ${tier}`)
  return SOURCE_TIER_FOR[tier]!
}

// Build a `Pyramid` for a specific R2 binding. Cascade re-builds per
// invocation (cheap) so the `Env` binding isn't captured at module load.
export function makePyramid(r2: R2Bucket): Pyramid {
  return pyramidFromConfig(PYRAMID_CONFIG, parquetBackend(r2Storage(r2)))
}
