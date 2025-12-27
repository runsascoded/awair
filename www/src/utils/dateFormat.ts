export function splitDate(date: Date) {
  const yyyy = String(date.getFullYear())
  const yy = yyyy.slice(-2)
  const m = String(date.getMonth() + 1)
  const mm = m.padStart(2, '0')
  const d= String(date.getDate())
  const dd = d.padStart(2, '0')
  const HH = String(date.getHours()).padStart(2, '0')
  const MM = String(date.getMinutes()).padStart(2, '0')
  const SS = String(date.getSeconds()).padStart(2, '0')

  return { yyyy, yy, m, mm, d, dd, HH, MM, SS }
}

/**
 * Format date for Plotly's x-axis (ISO-like format, local time)
 */
export function formatForPlotly(date: Date): string {
  const { yyyy, mm, dd, HH, MM, SS } = splitDate(date)
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`
}

/**
 * Compact date format for table display: "M/D H:MMa" or "M/D/YY H:MMa"
 */
export function formatCompactDate(date: Date): string {
  const currentYear = new Date().getFullYear()
  const dateYear = date.getFullYear()
  const month = String(date.getMonth() + 1)
  const day = String(date.getDate())
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  const ampm = hours < 12 ? 'a' : 'p'
  const yearPart = dateYear !== currentYear ? `/${String(dateYear).slice(-2)}` : ''
  return `${month}/${day}${yearPart} ${hour12}:${minutes}${ampm}`
}

/**
 * Full date format for tooltips: "M/D H:MM:SSam" with optional year and seconds
 */
export function formatFullDate(date: Date): string {
  const currentYear = new Date().getFullYear()
  const dateYear = date.getFullYear()
  const month = String(date.getMonth() + 1)
  const day = String(date.getDate())
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = date.getSeconds()
  const hour12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours
  const ampm = hours < 12 ? 'am' : 'pm'

  // Build time string, omitting :00 seconds and :00 minutes
  let timeStr = `${hour12}`
  if (minutes !== 0 || seconds !== 0) {
    timeStr += `:${String(minutes).padStart(2, '0')}`
  }
  if (seconds !== 0) {
    timeStr += `:${String(seconds).padStart(2, '0')}`
  }
  timeStr += ampm

  // Build date string, omitting year if current year
  const dateStr = dateYear === currentYear ? `${month}/${day}` : `${month}/${day}/${String(dateYear).slice(-2)}`

  return `${dateStr} ${timeStr}`
}
