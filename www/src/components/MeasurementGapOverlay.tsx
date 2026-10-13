import { useId } from 'react'
import { Tooltip } from './Tooltip'
import type { FormattedMeasurementGap } from '../utils/measurementGaps'

interface MeasurementGapOverlayProps {
  gaps: FormattedMeasurementGap[]
  genesis: number
  now: number
  tierCount: number
  activeGap: number | null
  onHoverGap: (start: number | null) => void
  onFocusGap: (start: number | null) => void
}

/** Match CoverTimeline's label gutter, time axis, and 17-unit row spacing. */
export function MeasurementGapOverlay({ gaps, genesis, now, tierCount, activeGap, onHoverGap, onFocusGap }: MeasurementGapOverlayProps) {
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
        return (
          <Tooltip key={gap.start} content={gap.label} maxWidth={360}>
            <rect
              x={x} y="0" width={width} height={Math.max(0, tierCount * 17 - 3)} fill={`url(#${patternId})`}
              className={`hp-gap-band${activeGap === gap.start ? ' hp-gap-active' : ''}`} tabIndex={0} aria-label={gap.label}
              data-gap-start={gap.start}
              onPointerEnter={() => onHoverGap(gap.start)} onPointerLeave={() => onHoverGap(null)}
              onFocus={() => onFocusGap(gap.start)} onBlur={() => onFocusGap(null)}
            />
          </Tooltip>
        )
      })}
    </svg>
  )
}
