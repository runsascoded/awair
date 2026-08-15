import { useMemo } from 'react'
import { useOmnibarEndpoint, type OmnibarEntry } from 'use-kbd'
import type { DeviceCover, HealthDevice, HealthRaw } from './useHealth'

/**
 * Omnibar endpoint (⌘K) over every present pyramid shard: min-cover
 * slots with registered keys (from `/health` `covers`) plus today's
 * live raw tips (from `raw`). Selecting an entry deep-links into the
 * `/files/*` browser's parquet viewer for that R2 object.
 *
 * Searchable by device name, tier, rung, period, or any key substring
 * (e.g. "gym m3", "137496 2026-07", "raw/1d").
 */
export function useShardSearch(
  covers: DeviceCover[] | undefined,
  devices: HealthDevice[] | undefined,
  raw: HealthRaw[] | undefined,
): void {
  const entries = useMemo(() => {
    const out: (OmnibarEntry & { search: string })[] = []
    const deviceName = (id: number) => devices?.find(d => d.deviceId === id)?.name ?? String(id)
    for (const cover of covers ?? []) {
      const name = deviceName(cover.deviceId)
      for (const t of cover.tiers) {
        for (const s of t.segments) {
          if (s.key === undefined) continue
          const label = `${name} · ${t.tier}/${s.shardDur} · ${s.start.slice(0, 10)}`
          out.push({
            id: `shard:${s.key}`,
            label,
            description: s.key,
            group: 'Shards',
            href: `/files/${s.key}`,
            search: `${label} ${s.key}`.toLowerCase(),
          })
        }
      }
    }
    for (const r of raw ?? []) {
      if (r.uploaded === null) continue
      const label = `${deviceName(r.deviceId)} · raw live tip (today)`
      out.push({
        id: `shard:${r.key}`,
        label,
        description: r.key,
        group: 'Shards',
        href: `/files/${r.key}`,
        search: `${label} ${r.key}`.toLowerCase(),
      })
    }
    return out
  }, [covers, devices, raw])

  useOmnibarEndpoint('shards', {
    filter: (query, { offset, limit }) => {
      // Every whitespace-separated term must match somewhere in the
      // entry ("gym m3 2026-07" narrows progressively).
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const matches = entries.filter(e => terms.every(t => e.search.includes(t)))
      return {
        entries: matches.slice(offset, offset + limit).map(({ search: _s, ...e }) => e),
        total: matches.length,
        hasMore: offset + limit < matches.length,
      }
    },
    group: 'Shards',
    pagination: 'scroll',
  })
}
