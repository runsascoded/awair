import { useShardOmnibarEndpoint, type ShardSearchEntry } from 'pyrmts-react/kbd'
import { useCallback, useMemo } from 'react'
import type { DeviceCover, HealthDevice, HealthRaw } from './useHealth'

// Deep-link a shard's storage key into the `/files/*` parquet viewer.
// Module-level so it stays referentially stable across renders.
const hrefFor = (key: string) => `/files/${key}`

/**
 * Omnibar endpoint (⌘K) over every present pyramid shard, delegating to
 * `pyrmts-react/kbd`'s `useShardOmnibarEndpoint` (the shared cover-derived
 * search) — awair only supplies the two things it can't infer: mapping a
 * pyramid name (`awair-<id>`) to the device's display name, and the live
 * raw tips (Lambda writes bypass the shard registry, so `pyramidCover`
 * doesn't know them). Selecting an entry deep-links into `/files/*`.
 *
 * Searchable by device name, tier, rung, period, or any key substring
 * (e.g. "gym m3", "137496 2026-07", "raw/1d").
 */
export function useShardSearch(
  covers: DeviceCover[] | undefined,
  devices: HealthDevice[] | undefined,
  raw: HealthRaw[] | undefined,
): void {
  const deviceName = useCallback(
    (id: number) => devices?.find(d => d.deviceId === id)?.name ?? String(id),
    [devices],
  )
  const pyramidLabel = useCallback(
    (pyramidName: string) => {
      const id = Number(pyramidName.replace(/^awair-/, ''))
      return Number.isNaN(id) ? pyramidName : deviceName(id)
    },
    [deviceName],
  )
  const extraEntries = useMemo<ShardSearchEntry[]>(() => {
    const out: ShardSearchEntry[] = []
    for (const r of raw ?? []) {
      if (r.uploaded === null) continue
      const label = `${deviceName(r.deviceId)} · raw live tip (today)`
      out.push({
        id: `shard:${r.key}`,
        label,
        description: r.key,
        group: 'Shards',
        href: hrefFor(r.key),
        search: `${label} ${r.key}`.toLowerCase(),
      })
    }
    return out
  }, [deviceName, raw])

  useShardOmnibarEndpoint(covers, { hrefFor, pyramidLabel, extraEntries })
}
