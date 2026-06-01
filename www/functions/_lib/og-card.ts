/// <reference types="@cloudflare/workers-types" />

/**
 * Shared helpers for `functions/og.ts` (renders the OG image) and
 * `functions/_middleware.ts` (rewrites `<meta og:image>` to point at the
 * current request's query string).
 *
 * The OG endpoint accepts the same URL params as the SPA — `y` (axes),
 * `t` (time range), `d` (devices), `s` (smoothing) — and renders a
 * 1200×630 card that approximates the live chart. Phase A returns a
 * minimal "headline" card; Phase B will fetch pyrmts data and draw the
 * actual traces.
 */

export const OG_W = 1200
export const OG_H = 630

/** Subset of params the OG endpoint cares about. */
export interface OgParams {
  /** Raw query string (without leading `?`), used as the cache key. */
  rawSearch: string
  /** Devices in display order. Empty array → all (callers can pick a default). */
  devices: string[]
  /** Encoded time range (`-6h`, `251123T0432`, etc.). null → default 1d. */
  timeRange: string | null
  /** Encoded y-axes (`tcaA`, `pv`, etc.). null → default temp+co2. */
  yAxes: string | null
  /** Smoothing string the worker accepts (`auto`, `3h`, `1d`, etc.). null → off. */
  smoothing: string | null
}

export function parseOgParams(search: URLSearchParams): OgParams {
  const rawSearch = search.toString()
  const d = search.get('d') ?? ''
  // Devices encode with `+` as separator; the URLSearchParams `get` already
  // unescaped `+` → space, so split on whitespace and drop empties.
  const devices = d.trim().split(/\s+/).filter(Boolean)
  return {
    rawSearch,
    devices,
    timeRange: search.get('t'),
    yAxes: search.get('y'),
    smoothing: search.get('s'),
  }
}

/** Pretty-print a time-range token (`-6h` → "Last 6 hours", `-30d` → "Last 30 days"). */
export function formatTimeRange(t: string | null): string {
  if (!t) return 'Last 24 hours'
  const m = /^-(\d+)([mhd])$/.exec(t)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    const unit = { m: 'minute', h: 'hour', d: 'day' }[m[2] as 'm' | 'h' | 'd']
    return `Last ${n} ${unit}${n === 1 ? '' : 's'}`
  }
  return t
}

const METRIC_NAMES: Record<string, string> = {
  t: 'Temp',
  c: 'CO₂',
  h: 'Humidity',
  p: 'PM2.5',
  v: 'VOC',
}

/** Decode a y-axes token (`tcaA`) into display labels. */
export function formatYAxes(y: string | null): string {
  if (!y) return 'Temp + CO₂'
  const stripped = y.replace(/[aA]/g, '')
  const left = METRIC_NAMES[stripped[0]] ?? '?'
  const right = stripped[1] ? METRIC_NAMES[stripped[1]] : null
  return right ? `${left} + ${right}` : left
}

export function formatSmoothing(s: string | null): string {
  if (!s) return 'Raw'
  if (s === 'auto') return 'Auto smoothing'
  return `${s} smoothing`
}

export function formatDevices(devices: string[]): string {
  if (devices.length === 0) return 'All devices'
  return devices.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(' · ')
}
