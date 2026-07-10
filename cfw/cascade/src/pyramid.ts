// Parse the shared awair `pyramid.yml` (bundled by wrangler as raw text
// per the `rules` in `wrangler.toml`) once at module load. Config is
// immutable per deploy — no hot-reload path needed.

import { parsePyramidYaml, pyramidFromConfig, parquetBackend, type PyramidConfig, type Pyramid } from 'pyrmts'
import { r2Storage } from 'pyrmts-cfw'
import pyramidYamlText from '../../../src/awair/pyramid.yml'

export const PYRAMID_CONFIG: PyramidConfig = parsePyramidYaml(pyramidYamlText)

// pyrmts pyramid "name" for D1 rows. Not user-facing; must be stable
// across deploys so ShardIndex rows stay associated with this deploy's
// pyramid. Prod uses `'awair'`; the `dev` wrangler env overrides via
// `PYRAMID_NAME` var.
export const DEFAULT_PYRAMID_NAME = 'awair'

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
