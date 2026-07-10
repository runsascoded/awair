// Parse the shared awair `pyramid.yml` (bundled by wrangler as raw text
// per the `rules` in `wrangler.toml`) once at module load. Config is
// immutable per deploy — no hot-reload path needed.

import { parsePyramidYaml, pyramidFromConfig, parquetBackend, type PyramidConfig, type Pyramid } from 'pyrmts'
import { r2Storage } from 'pyrmts-cfw'
import pyramidYamlText from '../../../src/awair/pyramid.yml'

// Newer pyrmts (post `2a3d234`, unified shard-duration ladder) parses
// `shards: [<dur>, ...]` plural. The shared `src/awair/pyramid.yml` is
// still on the pre-ladder singular `shard: <dur>` shape because the
// Python builder + `cfw/serve` (older pyrmts pin) still expect it.
// Rewrite the YAML text on the fly here so we can move to the newer
// parser without breaking the other consumers.
//
// Awair's key template doesn't include `{shard}`, so this rewrite is
// scoped strictly to the tier block. If a future pyramid.yml adds
// `{shard}` to the key template, either update this preprocessing or
// migrate everyone to the plural form.
const normalizedYaml = pyramidYamlText.replace(/(\bshard:\s+)(\S+)/g, 'shards: [$2]')
export const PYRAMID_CONFIG: PyramidConfig = parsePyramidYaml(normalizedYaml)

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

// Order pyramid.yml declares tiers. `sourceTierFor(t)` returns the tier
// immediately before `t` in this list (`null` for `raw`).
export const TIER_ORDER: string[] = PYRAMID_CONFIG.tiers.map(t => t.name)

export function sourceTierFor(tier: string): string | null {
  const i = TIER_ORDER.indexOf(tier)
  if (i <= 0) return null
  return TIER_ORDER[i - 1] ?? null
}

// Build a `Pyramid` for a specific R2 binding. Cascade re-builds per
// invocation (cheap) so the `Env` binding isn't captured at module load.
export function makePyramid(r2: R2Bucket): Pyramid {
  return pyramidFromConfig(PYRAMID_CONFIG, parquetBackend(r2Storage(r2)))
}
