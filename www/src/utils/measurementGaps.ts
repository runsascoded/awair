export interface MeasurementGap {
  start: number
  end: number
}

export interface FormattedMeasurementGap extends MeasurementGap {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  duration: string
  durationHours: number
  durationMinutes: number
  label: string
}

/** Source gaps use minute boundaries; labels use the client's locale and zone. */
export function formatMeasurementGap(
  gap: MeasurementGap,
  { locale, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone, now = Date.now() }: {
    locale?: string
    timeZone?: string
    now?: number
  } = {},
): FormattedMeasurementGap {
  const start = new Date(gap.start)
  const end = new Date(gap.end)
  const calendar = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' })
  const year = (date: Date) => calendar.formatToParts(date).find(part => part.type === 'year')!.value
  const startYear = year(start)
  const endYear = year(end)
  const currentYear = year(new Date(now))
  const dateLabel = (date: Date, includeYear: boolean) => new Intl.DateTimeFormat(locale, {
    timeZone, month: 'numeric', day: 'numeric', ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(date)
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const zonedTime = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
  const zone = (date: Date) => zonedTime.formatToParts(date).find(part => part.type === 'timeZoneName')!.value
  const changesOffset = zone(start) !== zone(end)
  const timeLabel = (date: Date) => (changesOffset ? zonedTime : time).formatToParts(date)
    .map(part => part.type === 'hour' ? part.value.replace(/^0/, '\u2007') : part.value).join('')
  const startDate = dateLabel(start, startYear !== currentYear || startYear !== endYear)
  const startTime = timeLabel(start)
  const endDate = calendar.format(start) === calendar.format(end) ? '' : dateLabel(end, startYear !== endYear)
  const endTime = timeLabel(end)
  const startLabel = `${startDate} ${startTime.trimStart()}`
  const endLabel = endDate ? `${endDate} ${endTime.trimStart()}` : endTime.trimStart()
  const minutes = Math.round((gap.end - gap.start) / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const duration = hours === 0 ? `${minutes}m` : `${hours}h${remainder === 0 ? '' : ` ${remainder}m`}`
  return {
    ...gap, startDate, startTime, endDate, endTime, duration,
    durationHours: hours, durationMinutes: remainder,
    label: `Missing measurements: ${startLabel} → ${endLabel} · ${duration} (${timeZone})`,
  }
}
