import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useFloating,
} from '@floating-ui/react'
import { useState } from 'react'
import type { TierCover } from '../hooks/useHealth'

const MS_PER_DAY = 86_400_000

/** Today's live raw tip (from the R2 HEAD in `/health`'s `raw` section).
 *  Lambda-owned and unregistered, so it's outside `pyramidCover`'s
 *  min-cover — drawn as an extra segment on the raw row to close the
 *  visual gap between the last cover slot and `now`. */
export interface RawTip {
  start: number
  end: number
  key: string
  uploaded: number
}

interface TierTimelineProps {
  tiers: TierCover[]
  genesis: number
  now: number
  rawTip?: RawTip | null
}

/** Hovered-segment payload for the (single, shared) floating tooltip. */
interface TipState {
  tier: string
  shardDur: string
  status: 'present' | 'pending' | 'missing' | 'live tip'
  start?: string
  end?: string
  key?: string
  buildableAt?: string
  uploaded?: number
}

const fmtDay = (iso: string) => iso.slice(0, 10)
const fileHref = (key: string) => `/files/${key}`

/**
 * Coverage timeline for a single device, rendered from `pyramidCover`
 * min-cover segments: one row per tier, one rectangle per cover slot,
 * colored by status (present / pending / missing). Slots are per-shard,
 * so rung boundaries show as strokes; the uncovered head right of the
 * last slot (the current open period) stays background-colored.
 *
 * Slots with a registered key are clickable — they deep-link into the
 * `/files/*` browser's parquet viewer for that R2 object — and every
 * slot gets a floating tooltip (one shared `useFloating` instance,
 * re-anchored to the hovered rect; not per-rect, which would mount
 * hundreds of hook instances per timeline).
 *
 * X-axis maps `[genesis, now]` → `[0, 1000]` in the SVG viewBox so the
 * bar scales to whatever CSS width the container has.
 */
export function TierTimeline({ tiers, genesis, now, rawTip }: TierTimelineProps) {
  const [tip, setTip] = useState<TipState | null>(null)
  const { refs, floatingStyles } = useFloating({
    open: tip !== null,
    placement: 'top',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hoverProps = (state: TipState) => ({
    onPointerEnter: (e: React.PointerEvent<SVGRectElement>) => {
      refs.setReference(e.currentTarget)
      setTip(state)
    },
    onPointerLeave: () => setTip(null),
  })
  const clickProps = (key: string | undefined) => key === undefined ? {} : {
    onClick: () => window.location.assign(fileHref(key)),
  }
  const segClass = (status: string, key: string | undefined) =>
    `tt-seg-${status}${key !== undefined ? ' tt-clickable' : ''}`

  const range = Math.max(1, now - genesis)
  const toX = (t: number) => ((t - genesis) / range) * 1000

  const rowH = 14
  const rowGap = 3
  const labelW = 42
  const svgW = 1000  // viewBox width; CSS scales to 100%.
  const rows = tiers.length
  const svgH = rows * (rowH + rowGap)

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
        {tiers.map((t, i) => {
          const y = i * (rowH + rowGap)
          return (
            <g key={t.tier} className="tt-row">
              {/* Left-side tier label (SVG text so it scales with the bar). */}
              <text
                x={labelW - 4}
                y={y + rowH - 3}
                textAnchor="end"
                className="tt-label"
              >
                {t.tier}
              </text>
              {/* Row background — the "outside cover" color (open head). */}
              <rect
                x={labelW}
                y={y}
                width={svgW}
                height={rowH}
                className="tt-bg"
              />
              {t.segments.map(s => {
                const start = Date.parse(s.start)
                const end = Date.parse(s.end)
                const x0 = toX(Math.max(start, genesis))
                const x1 = toX(Math.min(end, now))
                const w = Math.max(0.3, x1 - x0)
                return (
                  <rect
                    key={s.start}
                    x={labelW + x0}
                    y={y}
                    width={w}
                    height={rowH}
                    className={segClass(s.status, s.key)}
                    {...hoverProps({
                      tier: t.tier,
                      shardDur: s.shardDur,
                      status: s.status,
                      start: s.start,
                      end: s.end,
                      key: s.key,
                      buildableAt: s.buildableAt,
                    })}
                    {...clickProps(s.key)}
                  />
                )
              })}
              {t.tier === 'raw' && rawTip != null && (
                <rect
                  x={labelW + toX(Math.max(rawTip.start, genesis))}
                  y={y}
                  width={Math.max(0.3, toX(Math.min(rawTip.end, now)) - toX(Math.max(rawTip.start, genesis)))}
                  height={rowH}
                  className="tt-seg-tip tt-clickable"
                  {...hoverProps({
                    tier: 'raw',
                    shardDur: '1d',
                    status: 'live tip',
                    key: rawTip.key,
                    uploaded: rawTip.uploaded,
                  })}
                  {...clickProps(rawTip.key)}
                />
              )}
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
      {tip !== null && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="tt-tooltip">
            <div className="tt-tooltip-title">
              {tip.tier} · {tip.shardDur} · <span className={`tt-status-${tip.status.replace(' ', '-')}`}>{tip.status}</span>
            </div>
            {tip.start !== undefined && tip.end !== undefined && (
              <div>{fmtDay(tip.start)} → {fmtDay(tip.end)}</div>
            )}
            {tip.uploaded !== undefined && (
              <div>uploaded {new Date(tip.uploaded).toISOString().slice(0, 19)}Z</div>
            )}
            {tip.buildableAt !== undefined && (
              <div>buildable at {tip.buildableAt.slice(0, 16)}Z</div>
            )}
            {tip.key !== undefined && (
              <>
                <div className="tt-tooltip-key">{tip.key}</div>
                <div className="tt-tooltip-hint">click to browse</div>
              </>
            )}
          </div>
        </FloatingPortal>
      )}
      <div className="tt-legend">
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-present-swatch" /> present</span>
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-pending-swatch" /> pending</span>
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-missing-swatch" /> missing</span>
        {rawTip != null && (
          <span className="tt-legend-item"><span className="tt-legend-swatch tt-tip-swatch" /> live tip</span>
        )}
        <span className="tt-legend-item"><span className="tt-legend-swatch tt-now-swatch" /> now</span>
      </div>
    </div>
  )
}

// Shared helper for the parent to compute a device's coverage window from
// the cover's `[genesis, now)` bounds; extended by a small left margin so
// the first shard doesn't hug the axis.
export function coverageWindow(genesisTs: number, now: number): { genesis: number; now: number } {
  const spanDays = (now - genesisTs) / MS_PER_DAY
  const pad = Math.max(1, spanDays * 0.02) * MS_PER_DAY
  return { genesis: genesisTs - pad, now }
}
