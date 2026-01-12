import { floor } from '@rdub/base'

interface IntervalOption {
  label: string
  minutes: number
}

interface IntervalSelectProps {
  /** Current value in minutes */
  value: number
  /** Preset options */
  options: IntervalOption[]
  /** Called when selection changes */
  onChange: (minutes: number) => void
  /** CSS class for the select element */
  className?: string
  /** Special value that means "off" or "none" (e.g., 1 for smoothing = off) */
  offValue?: number
  /** Label for the off value (default: "Off") */
  offLabel?: string
}

/**
 * Format minutes as compact duration string (e.g., "4h", "2d12h", "30m").
 */
export function formatMinutes(minutes: number): string {
  const days = floor(minutes / 1440)
  const hours = floor((minutes % 1440) / 60)
  const mins = minutes % 60

  if (days > 0 && hours > 0) {
    return `${days}d${hours}h`
  } else if (days > 0) {
    return `${days}d`
  } else if (hours > 0 && mins > 0) {
    return `${hours}h${mins}m`
  } else if (hours > 0) {
    return `${hours}h`
  } else {
    return `${mins}m`
  }
}

/**
 * Dropdown select for interval/duration values with preset options and custom value support.
 *
 * When the current value doesn't match a preset, a custom option is inserted
 * in sorted position showing the formatted duration.
 */
export function IntervalSelect({
  value,
  options,
  onChange,
  className,
  offValue,
  offLabel = 'Off',
}: IntervalSelectProps) {
  // Check if current value matches a preset
  const isPreset = options.some(opt => opt.minutes === value)
  const isOff = offValue !== undefined && value === offValue

  // Build options list, inserting custom if needed
  const selectOptions = [...options]

  if (!isPreset && !isOff) {
    // Find insertion point (sorted by minutes, but "off" stays first if present)
    const insertIdx = selectOptions.findIndex(opt =>
      opt.minutes !== offValue && opt.minutes > value
    )
    selectOptions.splice(insertIdx === -1 ? selectOptions.length : insertIdx, 0, {
      label: formatMinutes(value),
      minutes: value,
    })
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={className}
    >
      {selectOptions.map(opt => (
        <option key={opt.minutes} value={opt.minutes}>
          {opt.minutes === offValue ? offLabel : opt.label}
        </option>
      ))}
    </select>
  )
}
