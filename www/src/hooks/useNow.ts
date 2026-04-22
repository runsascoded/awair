import { useEffect, useState } from 'react'

/**
 * Re-render periodically with the current time. Used to keep "X seconds ago"
 * style labels live without plumbing state updates through data props.
 * Suspends ticks while the tab is hidden.
 */
export function useNow(intervalMs = 5000): Date {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    if (document.hidden) return
    const id = setInterval(() => setNow(new Date()), intervalMs)
    const onVis = () => { if (!document.hidden) setNow(new Date()) }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs])
  return now
}

/**
 * Format an elapsed duration (ms) as a compact age string: `<1m`, `4m`, `2h`, `3d`.
 * Sub-minute is collapsed since sensor cadence is ~1/min — seconds would tick
 * noisily without adding information. Returns `'–'` for null/invalid.
 */
export function formatAge(ms: number | null): string {
  if (ms === null || !isFinite(ms) || ms < 0) return '–'
  if (ms < 60_000) return '<1m'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
