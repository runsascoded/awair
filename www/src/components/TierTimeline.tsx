import type { HealthTier } from '../hooks/useHealth'

const MS_PER_DAY = 86_400_000

interface TierTimelineProps {
  tiers: HealthTier[]
  tierOrder: string[]
  genesis: number
  now: number
}

/**
 * Coverage timeline for a single device: one row per tier, one rectangle
 * per shard spanning `[periodStart, min(periodEnd, now)]`. Missing spans
 * show as the background color. Ctbk-style, but simpler — awair currently
 * has one rung per tier, so there's no dust vs max-rung distinction to
 * draw. When we move to multi-rung tiers (spec/cfw-cascade B), this
 * component will need to layer rung-color bands.
 *
 * X-axis maps `[genesis, now]` → `[0, 1000]` in the SVG viewBox so the
 * bar scales to whatever CSS width the container has.
 */
export function TierTimeline({ tiers, tierOrder, genesis, now }: TierTimelineProps) {
  const range = Math.max(1, now - genesis)
  const toX = (t: number) => ((t - genesis) / range) * 1000

  const rowH = 14
  const rowGap = 3
  const labelW = 42
  const svgW = 1000  // viewBox width; CSS scales to 100%.
  const rows = tierOrder.length
  const svgH = rows * (rowH + rowGap)

  const byTier = new Map(tiers.map(t => [t.tier, t]))

  // Month gridlines: first-of-month between genesis and now.
  const gridlines: { x: number; label?: string; major: boolean }[] = []
  {
    const start = new Date(genesis)
    start.setUTCDate(1)
    start.setUTCHours(0, 0, 0, 0)
    for (let t = start.getTime(); t <= now; ) {
      const d = new Date(t)
      const isJan = d.getUTCMonth() === 0
      const label = isJan ? String(d.getUTCFullYear()) : d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
      gridlines.push({ x: toX(t), label, major: isJan })
      // Advance one month.
      d.setUTCMonth(d.getUTCMonth() + 1)
      t = d.getTime()
    }
  }

  return (
    <div className="tier-timeline">
      <svg
        viewBox={`0 0 ${svgW + labelW} ${svgH + 14}`}
        preserveAspectRatio="none"
        className="tier-timeline-svg"
        aria-label="Coverage timeline"
      >
        {/* Month gridlines behind everything else. */}
        <g className="tt-grid">
          {gridlines.map((g, i) => (
            <line
              key={i}
              x1={labelW + g.x}
              x2={labelW + g.x}
              y1={0}
              y2={svgH}
              className={g.major ? 'tt-grid-major' : 'tt-grid-minor'}
            />
          ))}
        </g>

        {/* One row per tier. */}
        {tierOrder.map((name, i) => {
          const t = byTier.get(name)
          const y = i * (rowH + rowGap)
          const shards = t?.shards ?? []
          return (
            <g key={name} className="tt-row">
              {/* Left-side tier label (SVG text so it scales with the bar). */}
              <text
                x={labelW - 4}
                y={y + rowH - 3}
                textAnchor="end"
                className="tt-label"
              >
                {name}
              </text>
              {/* Row background — the "missing" color; shards paint over it. */}
              <rect
                x={labelW}
                y={y}
                width={svgW}
                height={rowH}
                className="tt-bg"
              />
              {shards.map(s => {
                const x0 = toX(Math.max(s.periodStart, genesis))
                const x1 = toX(Math.min(s.periodEnd, now))
                const w = Math.max(0.3, x1 - x0)
                return (
                  <rect
                    key={s.periodStart}
                    x={labelW + x0}
                    y={y}
                    width={w}
                    height={rowH}
                    className="tt-shard"
                  >
                    <title>
                      {name} · {s.shardDur}{'\n'}
                      {new Date(s.periodStart).toISOString().slice(0, 10)}
                      {' → '}
                      {new Date(s.periodEnd).toISOString().slice(0, 10)}
                      {'\n'}written {new Date(s.writtenAt).toISOString().slice(0, 19)}Z
                    </title>
                  </rect>
                )
              })}
            </g>
          )
        })}

        {/* "Now" marker */}
        <line
          x1={labelW + toX(now)}
          x2={labelW + toX(now)}
          y1={0}
          y2={svgH}
          className="tt-now"
        />

        {/* Month labels — below all rows. */}
        <g className="tt-axis">
          {gridlines.filter(g => g.label !== undefined).map((g, i) => (
            <text
              key={i}
              x={labelW + g.x + 2}
              y={svgH + 10}
              className={g.major ? 'tt-axis-major' : 'tt-axis-minor'}
            >
              {g.label}
            </text>
          ))}
        </g>
      </svg>
      <div className="tt-legend">
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-shard-swatch" /> present</span>
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-bg-swatch" /> missing</span>
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-now-swatch" /> now</span>
      </div>
    </div>
  )
}

// Re-export a shared helper for the parent to compute a device's coverage
// window. Currently uses the D1 genesis (first-of-month UTC of earliest
// raw shard) as the left edge; extended by a small margin for readability.
export function coverageWindow(genesisTs: number, now: number): { genesis: number; now: number } {
  const spanDays = (now - genesisTs) / MS_PER_DAY
  // Add ~2% padding on the left so the first shard doesn't hug the axis.
  const pad = Math.max(1, spanDays * 0.02) * MS_PER_DAY
  return { genesis: genesisTs - pad, now }
}
