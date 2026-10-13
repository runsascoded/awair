import { useId } from 'react'
import { Tooltip } from './Tooltip'

interface MeasurementGapOverlayProps {
  gaps: { start: number; end: number }[]
  genesis: number
  now: number
  tierCount: number
}

/** Match CoverTimeline's label gutter, time axis, and 17-unit row spacing. */
export function MeasurementGapOverlay({ gaps, genesis, now, tierCount }: MeasurementGapOverlayProps) {
  const patternId = useId().replaceAll(':', '')
  const toX = (time: number) => 42 + 1000 * (time - genesis) / Math.max(1, now - genesis)

  return (
    <svg className="hp-gap-overlay" viewBox={`0 0 1042 ${tierCount * 17 + 14}`} preserveAspectRatio="none" aria-label="Confirmed measurement gaps">
      <defs>
        <pattern id={patternId} width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" className="hp-gap-fill" />
          <path d="M-1 1L1-1M0 4L4 0M3 5L5 3" className="hp-gap-hatch" />
        </pattern>
      </defs>
      {gaps.filter(gap => gap.end > genesis && gap.start < now).map(gap => {
        const x = toX(Math.max(gap.start, genesis))
        const width = Math.max(0.3, toX(Math.min(gap.end, now)) - x)
        const startLabel = new Date(gap.start).toISOString().slice(0, 16).replace('T', ' ')
        const endLabel = new Date(gap.end).toISOString().slice(0, 16).replace('T', ' ')
        const label = `Missing measurements: ${startLabel} → ${endLabel} UTC`
        return (
          <Tooltip key={gap.start} content={label}>
            <rect x={x} y="0" width={width} height={Math.max(0, tierCount * 17 - 3)} fill={`url(#${patternId})`} className="hp-gap-band" tabIndex={0} aria-label={label} />
          </Tooltip>
        )
      })}
    </svg>
  )
}
