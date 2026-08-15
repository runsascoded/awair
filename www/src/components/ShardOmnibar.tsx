import { Omnibar } from 'use-kbd'
import { useHealth } from '../hooks/useHealth'
import { useShardSearch } from '../hooks/useShardSearch'

/**
 * Self-contained ⌘K omnibar with pyramid-shard search: fetches `/health`
 * (shared TSQ cache with `HealthPage` — no duplicate request when both
 * mount) and registers every present shard key as a searchable entry
 * deep-linking into `/files/*`. Dropped into both the health and files
 * pages; `ChartApp` has its own `<Omnibar>` with chart actions instead.
 */
export function ShardOmnibar() {
  const { data } = useHealth()
  useShardSearch(data?.covers, data?.devices, data?.raw)
  return <Omnibar placeholder="Search shards…" maxResults={15} />
}
