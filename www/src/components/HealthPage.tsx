import { TierTimeline, coverageWindow, type RawTip } from './TierTimeline'
import { useHealth } from '../hooks/useHealth'
import './HealthPage.scss'

const MS_PER_DAY = 86_400_000

/** Format a ms timestamp as compact ISO `YYYY-MM-DD HH:MM:SSZ` (UTC). */
function fmtTs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const d = new Date(ms)
  const iso = d.toISOString()
  return iso.slice(0, 19).replace('T', ' ') + 'Z'
}

/** Format a duration in ms as a short humanized string (`3s`, `4m`, `2h`, `5d`). */
function fmtAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

/** Format a byte count as KiB / MiB. */
function fmtBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

/** Format a numeric count. Small ints exact, larger with 1 decimal. */
function fmtNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  if (n < 100) return n.toFixed(n === Math.floor(n) ? 0 : 1)
  if (n < 1000) return n.toFixed(0)
  if (n < 10_000) return (n / 1000).toFixed(2) + 'k'
  if (n < 1_000_000) return (n / 1000).toFixed(0) + 'k'
  return (n / 1_000_000).toFixed(1) + 'M'
}

/** Bucket raw-shard age into a freshness class. Thresholds match `cfw/monitor`'s
 *  base cadence: <2m fresh, <10m warning, <60m degraded, >60m stale. */
function ageClass(ms: number | null): string {
  if (ms === null) return 'age-unknown'
  if (ms < 2 * 60_000) return 'age-fresh'
  if (ms < 10 * 60_000) return 'age-warn'
  if (ms < 60 * 60_000) return 'age-degraded'
  return 'age-stale'
}

export function HealthPage() {
  const { data, error, isLoading, isFetching, refetch } = useHealth()

  if (isLoading) {
    return (
      <div className="health-page">
        <h1>Health</h1>
        <p className="hp-loading">Loading /health…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="health-page">
        <h1>Health</h1>
        <p className="hp-error">
          Failed to load: {error instanceof Error ? error.message : 'no data'}
        </p>
        <button onClick={() => refetch()}>Retry</button>
      </div>
    )
  }

  const { now, worker, devices, raw, covers, tierStats, config } = data

  return (
    <div className="health-page">
      <header className="hp-header">
        <h1>Health</h1>
        <div className="hp-meta">
          <span><strong>worker:</strong> {worker}</span>
          <span><strong>now:</strong> {fmtTs(now)}</span>
          <span className={isFetching ? 'hp-fetching' : ''}>
            {isFetching ? 'refreshing…' : `next refresh in ≤30s`}
          </span>
          <button onClick={() => refetch()} disabled={isFetching}>Refresh</button>
        </div>
      </header>

      <section className="hp-section">
        <h2>Raw freshness (R2)</h2>
        <p className="hp-sub">
          Per-device HEAD on the current-day <code>raw</code> tip shard. This
          is the source of truth for freshness — Lambda writes bypass D1, so
          the coverage/stats below trail these values.
        </p>
        <table className="hp-table">
          <thead>
            <tr>
              <th>device</th>
              <th>id</th>
              <th>key</th>
              <th>uploaded</th>
              <th>age</th>
              <th>size</th>
            </tr>
          </thead>
          <tbody>
            {raw.map(r => {
              const device = devices.find(d => d.deviceId === r.deviceId)
              return (
                <tr key={r.deviceId} className={ageClass(r.ageMs)}>
                  <td>{device?.name ?? '?'}</td>
                  <td className="hp-mono">{r.deviceId}</td>
                  <td className="hp-mono">{r.key}</td>
                  <td>{fmtTs(r.uploaded)}</td>
                  <td className="hp-age">{fmtAge(r.ageMs)}</td>
                  <td>{fmtBytes(r.size)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="hp-section">
        <h2>Pyramid coverage</h2>
        <p className="hp-sub">
          Per-device <code>pyramidCover</code> min-cover of
          [genesis, now): which cover slots are registered in D1 (raw tips
          overlaid from R2 — Lambda writes bypass the registry). The
          timeline draws one rectangle per cover slot; the stats table
          below shows per-rung size/RG aggregates from
          <code> pyramid_shards</code>. <em>latest write</em> is when
          cascade last wrote a shard at that rung — old ages are normal
          when nothing needs rebuilding.
        </p>
        {covers.map(cover => {
          const device = devices.find(d => d.deviceId === cover.deviceId)
          const rungs = tierStats.find(s => s.deviceId === cover.deviceId)?.rungs ?? []
          const genesis = Date.parse(cover.genesis)
          const window = coverageWindow(genesis, now)
          // Today's live raw tip (unregistered — outside the cover):
          // drawn from UTC midnight to now when the R2 HEAD found it.
          const rawHead = raw.find(r => r.deviceId === cover.deviceId)
          const rawTip: RawTip | null = rawHead?.uploaded != null
            ? { start: now - (now % MS_PER_DAY), end: now, key: rawHead.key, uploaded: rawHead.uploaded }
            : null
          const badge = cover.totalMissing > 0
            ? { cls: 'hp-badge-missing', text: `${cover.totalMissing} missing` }
            : cover.totalPending > 0
              ? { cls: 'hp-badge-pending', text: `${cover.totalPending} pending` }
              : { cls: 'hp-badge-ok', text: 'complete' }
          return (
            <div key={cover.name} className="hp-pyramid">
              <h3>
                <span className="hp-name">{device?.name ?? cover.name}</span>
                <span className="hp-mono hp-dim"> · {cover.name}</span>
                <span className="hp-dim"> · genesis {fmtTs(genesis)}</span>
                <span className={`hp-badge ${badge.cls}`}>{badge.text}</span>
                {cover.totalStale > 0 && (
                  <span className="hp-badge hp-badge-stale" title="Registered D1 shards outside the current min-cover — superseded by coarser tiles; GC candidates.">
                    {cover.totalStale} stale
                  </span>
                )}
              </h3>
              <TierTimeline
                tiers={cover.tiers}
                genesis={window.genesis}
                now={window.now}
                rawTip={rawTip}
              />
              <table className="hp-table">
                <thead>
                  <tr>
                    <th>tier</th>
                    <th>rung</th>
                    <th>shards</th>
                    <th title="Average bytes per shard.">avg size</th>
                    <th title="Average rows per shard.">avg rows</th>
                    <th title="Average row groups per shard.">avg RGs</th>
                    <th title="Average rows per row group. Small values → many small RGs → good pruning, but per-RG metadata overhead. Target ~1000-10000.">rows/RG</th>
                    <th>latest write</th>
                    <th>write age</th>
                  </tr>
                </thead>
                <tbody>
                  {rungs.map(r => (
                    <tr key={`${r.tier}|${r.shardDur}`}>
                      <td className="hp-mono">{r.tier}</td>
                      <td className="hp-mono">{r.shardDur}</td>
                      <td className="hp-num">{r.shardCount}</td>
                      <td className="hp-num">{fmtBytes(r.stats.avgSizeBytes)}</td>
                      <td className="hp-num">{fmtNum(r.stats.avgNRows)}</td>
                      <td className="hp-num">{fmtNum(r.stats.avgNRgs)}</td>
                      <td className="hp-num">{fmtNum(r.stats.avgRowsPerRg)}</td>
                      <td>{fmtTs(r.latestWrittenAt)}</td>
                      <td className="hp-age hp-dim">{fmtAge(now - r.latestWrittenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}
      </section>

      <section className="hp-section">
        <h2>Devices</h2>
        <table className="hp-table">
          <thead>
            <tr>
              <th>id</th>
              <th>name</th>
              <th>type</th>
              <th>genesis</th>
              <th>active</th>
            </tr>
          </thead>
          <tbody>
            {devices.map(d => (
              <tr key={d.deviceId}>
                <td className="hp-mono">{d.deviceId}</td>
                <td>{d.name}</td>
                <td className="hp-mono">{d.deviceType}</td>
                <td>{fmtTs(d.genesisTs)}</td>
                <td>{d.active ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="hp-section">
        <h2>Pyramid config</h2>
        <p className="hp-sub">
          Static per-deploy — <code>src/awair/pyramid.yml</code>, bundled into
          <code> cfw/serve</code>.
        </p>
        <div className="hp-sub hp-mono">key: {config.keyTemplate}</div>
        <table className="hp-table">
          <thead>
            <tr><th>tier</th><th>bin</th><th>shard</th></tr>
          </thead>
          <tbody>
            {config.tiers.map(t => (
              <tr key={t.name}>
                <td className="hp-mono">{t.name}</td>
                <td className="hp-mono">{t.bin}</td>
                <td className="hp-mono">{t.shard}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
