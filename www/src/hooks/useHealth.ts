import { useQuery } from '@tanstack/react-query'
import { PYRMTS_ORIGIN } from '../services/awairService'

export interface HealthShard {
  shardDur: string
  periodStart: number
  periodEnd: number
  writtenAt: number
  sizeBytes: number | null
  nRows: number | null
  nRgs: number | null
  rgRowCounts: number[] | null
}

export interface TierStats {
  avgSizeBytes: number | null
  avgNRows: number | null
  avgNRgs: number | null
  avgRowsPerRg: number | null
  count: number
}

export interface HealthTier {
  tier: string
  shardDur: string
  shardCount: number
  latestPeriodEnd: number | null
  earliestPeriodStart: number | null
  latestWrittenAt: number | null
  d1UpdatedAt: number | null
  stats: TierStats
  shards: HealthShard[]
}

export interface HealthPyramid {
  pyramid: string
  deviceId: number
  tiers: HealthTier[]
}

export interface HealthRaw {
  deviceId: number
  key: string
  uploaded: number | null
  ageMs: number | null
  size: number | null
}

export interface HealthDevice {
  deviceId: number
  name: string
  deviceType: string
  genesisTs: number
  active: boolean
}

export interface HealthSnapshot {
  now: number
  worker: 'awair-serve'
  devices: HealthDevice[]
  raw: HealthRaw[]
  pyramids: HealthPyramid[]
  config: {
    keyTemplate: string
    tiers: { name: string; bin: string; shard: string }[]
  }
}

/**
 * Polls `cfw/serve /health` — the FE's live view of pyramid state
 * (per-device raw R2 watermarks + per-tier D1 shard counts / cascade
 * write watermarks). Refetches every 30s so the page tracks Lambda writes
 * without a manual reload.
 */
export function useHealth() {
  return useQuery<HealthSnapshot>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch(`${PYRMTS_ORIGIN}/health`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`/health returned ${res.status}`)
      return res.json() as Promise<HealthSnapshot>
    },
    refetchInterval: 30_000,
    staleTime: 5_000,
  })
}
