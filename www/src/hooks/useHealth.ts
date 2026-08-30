import { useQuery } from '@tanstack/react-query'
import { PYRMTS_ORIGIN } from '../services/awairService'

// Mirrors `pyrmts-cfw.health.PyramidCoverRung` — per-rung slot counts in
// a tier's current min-cover of `[genesis, now)`.
export interface CoverRung {
  shardDur: string
  role: 'max' | 'dust'
  expected: number
  present: number
  pending: number
}

// Mirrors `pyrmts-cfw.health.PyramidCoverSegment` — one min-cover slot,
// emitted per-shard (not coalesced) so tile boundaries are visible.
export interface CoverSegment {
  start: string      // ISO
  end: string        // ISO (exclusive)
  shardDur: string
  status: 'present' | 'pending' | 'missing'
  key?: string       // storage key (present segments)
  buildableAt?: string  // absent segments blocked on structural lag
}

// Mirrors `pyrmts-cfw.health.PyramidTierCoverStatus`.
export interface TierCover {
  tier: string
  bin: string
  maxRung: string
  rungs: CoverRung[]
  segments: CoverSegment[]
  totalExpected: number
  totalPresent: number
  totalPending: number
  complete: boolean
  firstMissingPeriod: string | null
  lastMaxBoundary: string
  dustAgeSec: number
  staleShardCount: number
}

// Mirrors `pyrmts-cfw.health.PyramidCoverStatus` + serve's `deviceId`.
export interface DeviceCover {
  deviceId: number
  name: string
  genesis: string
  now: string
  tiers: TierCover[]
  totalMissing: number
  totalPending: number
  totalStale: number
  allComplete: boolean
}

export interface TierStats {
  avgSizeBytes: number | null
  avgNRows: number | null
  avgNRgs: number | null
  avgRowsPerRg: number | null
  count: number
}

// Per-(tier, rung) D1 aggregates. Only rungs with ≥1 registered shard
// appear (Lambda-owned raw tips never register in D1).
export interface RungStats {
  tier: string
  shardDur: string
  shardCount: number
  latestWrittenAt: number
  stats: TierStats
}

export interface DeviceTierStats {
  pyramid: string
  deviceId: number
  rungs: RungStats[]
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

// Mirrors `pyrmts-cfw.SchemaDiff` — live D1 vs. `D1ShardIndex`'s expected
// objects. `ok` = no drift; otherwise `missing`/`mismatched` name them.
export interface SchemaDiff {
  ok: boolean
  missing: string[]
  mismatched: string[]
}

export interface HealthSnapshot {
  now: number
  worker: 'awair-serve'
  devices: HealthDevice[]
  raw: HealthRaw[]
  covers: DeviceCover[]
  tierStats: DeviceTierStats[]
  schema?: SchemaDiff
  config: {
    keyTemplate: string
    tiers: { name: string; bin: string; shard: string }[]
  }
}

/**
 * Polls `cfw/serve /health` — the FE's live view of pyramid state
 * (per-device raw R2 watermarks, `pyramidCover` min-cover status, and
 * per-rung D1 size/RG stats). Refetches every 30s so the page tracks
 * Lambda writes without a manual reload.
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
