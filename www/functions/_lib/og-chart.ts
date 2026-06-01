/// <reference types="@cloudflare/workers-types" />

/**
 * Phase B chart-rendering helpers for the OG image.
 *
 * Goal: get within shouting distance of the live Plotly chart at card
 * resolution. Each device-axis trace becomes (σ ribbon) + (thin raw line)
 * + (thick smoothed line). Metric base colors and the HSL-nudge
 * per-device offset are ported verbatim from
 * `src/components/ChartControls.tsx` (metric palette) and
 * `src/utils/deviceRenderStrategy.ts` (hsv-nudge), so the OG card and the
 * live chart agree on which device is which color.
 *
 * Why SVG (not Plotly): Satori's renderer is HTML+`<img>` only. Plotly
 * is DOM-bound. The SVG here is hand-rolled, embedded via
 * `data:image/svg+xml;base64,…`, and intentionally tight.
 */

const PYRMTS_BASE = 'https://awair-serve.ryan-0dc.workers.dev/q'

// Device-name → device-id mapping. Source of truth is
// `s3://380nwk/devices.parquet`; hardcoded here to skip a parquet read
// on every OG render. Add new devices as they come online.
const DEVICE_IDS: Record<string, number> = {
  br: 137496,
  gym: 17617,
  desk: 136824,
  rt: 137506,
}

export const DEFAULT_DEVICE_ID = DEVICE_IDS.br

export type Metric = 'temp' | 'co2' | 'humid' | 'pm25' | 'voc'

export interface MetricSpec {
  key: Metric
  label: string
  unit: string
  /** Base color, matched to `metricConfig` in `ChartControls.tsx`. */
  baseColor: string
}

const METRICS: Record<string, MetricSpec> = {
  t: { key: 'temp',  label: 'Temp',     unit: '°F',    baseColor: '#ff6384' },
  c: { key: 'co2',   label: 'CO₂',      unit: 'ppm',   baseColor: '#36a2eb' },
  h: { key: 'humid', label: 'Hum',      unit: '%',     baseColor: '#4bc0c0' },
  p: { key: 'pm25',  label: 'PM2.5',    unit: 'µg/m³', baseColor: '#9966ff' },
  v: { key: 'voc',   label: 'VOC',      unit: 'ppb',   baseColor: '#ff9f40' },
}

export interface YAxisSpec {
  left: MetricSpec
  right: MetricSpec | null
  leftAuto: boolean
  rightAuto: boolean
}

const DEFAULT_AXES: YAxisSpec = {
  left: METRICS.t,
  right: METRICS.c,
  leftAuto: false,
  rightAuto: false,
}

export function decodeYAxes(y: string | null): YAxisSpec {
  if (!y) return DEFAULT_AXES
  const leftAuto = y.includes('a')
  const rightAuto = y.includes('A')
  const chars = y.replace(/[aA]/g, '')
  const left = METRICS[chars[0]] ?? DEFAULT_AXES.left
  const right = chars[1] ? METRICS[chars[1]] ?? null : null
  return { left, right, leftAuto, rightAuto }
}

export interface ResolvedRange {
  from: Date
  to: Date
}

/**
 * Decode the `t=` token to a concrete [from, to). Supports the common
 * `-Nh` / `-Nd` / `-Nm` "latest mode" form; fixed-timestamp forms fall
 * back to a 24h window ending now.
 */
export function decodeTimeRange(t: string | null, now = new Date()): ResolvedRange {
  const oneDayMs = 24 * 60 * 60 * 1000
  if (!t) return { from: new Date(now.getTime() - oneDayMs), to: now }
  const m = /^-(\d+)([mhd])$/.exec(t)
  if (m) {
    const n = Number.parseInt(m[1], 10)
    const unit = m[2]
    const ms = n * (unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000)
    return { from: new Date(now.getTime() - ms), to: now }
  }
  return { from: new Date(now.getTime() - oneDayMs), to: now }
}

export function resolveDeviceIds(devices: string[]): number[] {
  if (devices.length === 0) return [DEFAULT_DEVICE_ID]
  return devices.map(d => DEVICE_IDS[d.toLowerCase()] ?? DEFAULT_DEVICE_ID)
}

export function deviceNameForId(id: number): string {
  for (const [name, did] of Object.entries(DEVICE_IDS)) {
    if (did === id) return name === 'rt' ? 'RT' : name.charAt(0).toUpperCase() + name.slice(1)
  }
  return String(id)
}

// pyrmts row shape — only fields we read. `_smooth_*` columns appear when
// `?smooth=` was requested.
interface PyrmtsRow {
  ts: number
  device_id: number
  [key: string]: number
}

export interface DeviceSeries {
  deviceId: number
  name: string
  records: PyrmtsRow[]
}

export async function fetchDeviceSeries(
  deviceIds: number[],
  range: ResolvedRange,
  smoothing: string | null,
  binBudget: number,
): Promise<DeviceSeries[]> {
  const url = new URL(PYRMTS_BASE)
  url.searchParams.set('from', range.from.toISOString())
  url.searchParams.set('to', range.to.toISOString())
  url.searchParams.set('bin_budget', String(binBudget))
  // Default OG render to `auto` smoothing if caller didn't ask for any —
  // shares often link the bare `?d=…&y=…` form and a smoothed line reads
  // far better at card resolution than 1m raw.
  url.searchParams.set('smooth', smoothing ?? 'auto')

  const fetches = deviceIds.map(async deviceId => {
    const u = new URL(url.toString())
    u.searchParams.set('device_id', String(deviceId))
    const resp = await fetch(u.toString())
    if (!resp.ok) throw new Error(`pyrmts ${deviceId} ${resp.status}`)
    const body = await resp.json() as { records: PyrmtsRow[] }
    return { deviceId, name: deviceNameForId(deviceId), records: body.records } satisfies DeviceSeries
  })
  return Promise.all(fetches)
}

interface MetricBin {
  /** Raw bin avg. */
  raw: number | null
  /** Smoothed bin avg (centered rolling). */
  smooth: number | null
  /** Population stddev of the smoothed window. */
  smoothStd: number | null
}

function binValues(row: PyrmtsRow, metric: Metric): MetricBin {
  const n = row[`${metric}_n`]
  const sum = row[`${metric}_sum`]
  const raw = typeof n === 'number' && n > 0 ? sum / n : null

  const sn = row[`${metric}_smooth_n`]
  const ssum = row[`${metric}_smooth_sum`]
  const ssumsq = row[`${metric}_smooth_sumsq`]
  let smooth: number | null = null
  let smoothStd: number | null = null
  if (typeof sn === 'number' && sn > 0) {
    smooth = ssum / sn
    if (typeof ssumsq === 'number') {
      const variance = Math.max(0, ssumsq / sn - smooth * smooth)
      smoothStd = Math.sqrt(variance)
    }
  }
  return { raw, smooth, smoothStd }
}

// Pyrmts already serves temp in °F (no conversion needed — matches
// `pyramidRowToAwairRecord` in `src/services/dataSources/pyrmtsSource.ts`
// which just does sum/n without any unit transform). All metrics
// pass through.
function toDisplay(_metric: Metric, v: number | null): number | null {
  return v
}
function toDisplayStd(_metric: Metric, v: number | null): number | null {
  return v
}

interface SeriesPoints {
  deviceId: number
  name: string
  /** null v = gap in this bin. */
  points: Array<{ t: number; raw: number | null; smooth: number | null; std: number | null }>
}

export function extractAxisSeries(devices: DeviceSeries[], metric: Metric): SeriesPoints[] {
  return devices.map(d => ({
    deviceId: d.deviceId,
    name: d.name,
    points: d.records.map(r => {
      const b = binValues(r, metric)
      return {
        t: r.ts,
        raw: toDisplay(metric, b.raw),
        smooth: toDisplay(metric, b.smooth),
        std: toDisplayStd(metric, b.smoothStd),
      }
    }),
  }))
}

export interface AxisBounds {
  min: number
  max: number
  /** ~5 nice tick values within [min, max], including endpoints. */
  ticks: number[]
}

export function computeBounds(
  series: SeriesPoints[],
  metric: Metric,
  auto: boolean,
): AxisBounds | null {
  const vals: number[] = []
  for (const s of series) {
    for (const p of s.points) {
      // Expand bounds to include σ ribbon extent so it doesn't clip.
      if (p.smooth !== null && p.std !== null) {
        vals.push(p.smooth + p.std, p.smooth - p.std)
      } else if (p.smooth !== null) {
        vals.push(p.smooth)
      }
      if (p.raw !== null) vals.push(p.raw)
    }
  }
  if (vals.length === 0) return null
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (!auto) {
    // Default mode pins min to 0 (matches the live chart's `rangemode: 'tozero'`).
    min = Math.min(0, min)
  } else {
    // Add a small (~5%) margin for breathing room.
    const span = max - min
    min -= span * 0.05
    max += span * 0.05
  }
  if (min === max) max = min + 1
  return { min, max, ticks: niceTicks(min, max, metric) }
}

/**
 * Nice round ticks across [min, max]. Picks ~5 ticks at a 1/2/5×10^k step,
 * snapped so the printed labels read clean. Endpoints may extend slightly.
 */
function niceTicks(min: number, max: number, metric: Metric): number[] {
  const span = max - min
  const target = 5
  const rawStep = span / target
  const pow = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / pow
  const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * pow
  const ticks: number[] = []
  const start = Math.ceil(min / niceStep) * niceStep
  for (let v = start; v <= max + 1e-9; v += niceStep) ticks.push(roundForMetric(v, metric))
  return ticks
}

function roundForMetric(v: number, metric: Metric): number {
  if (metric === 'co2' || metric === 'voc' || metric === 'pm25') return Math.round(v)
  return Math.round(v * 10) / 10
}

function fmtTick(v: number, metric: Metric): string {
  if (metric === 'co2' || metric === 'voc' || metric === 'pm25') return `${Math.round(v)}`
  return v.toFixed(1)
}

/* HSL helpers — ported from `src/utils/deviceRenderStrategy.ts`. */

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!m) return { h: 0, s: 50, l: 50 }
  const r = parseInt(m[1], 16) / 255
  const g = parseInt(m[2], 16) / 255
  const b = parseInt(m[3], 16) / 255
  const M = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (M + mn) / 2
  if (M !== mn) {
    const d = M - mn
    s = l > 0.5 ? d / (2 - M - mn) : d / (M + mn)
    if (M === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (M === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

function hslToHex({ h, s, l }: Hsl): string {
  s /= 100
  l /= 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else { r = c; b = x }
  const to = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }
  return `#${to(r)}${to(g)}${to(b)}`
}

/**
 * HSL-nudge: defaults match `DEFAULT_HSV_CONFIG` in
 * `deviceRenderStrategy.ts` — hueStep=0, saturationStep=0,
 * lightnessStep=15. For 2 devices → ±15 on L. Larger counts use a
 * symmetric multiplier walk centered on the middle index.
 */
function deviceColor(baseColor: string, deviceIdx: number, totalDevices: number): string {
  if (totalDevices <= 1) return baseColor
  const hsl = hexToHsl(baseColor)
  let multiplier = 0
  if (totalDevices === 2) multiplier = deviceIdx === 0 ? 1 : -1
  else if (totalDevices === 3) multiplier = deviceIdx === 0 ? 1 : deviceIdx === 1 ? 0 : -1
  else multiplier = (totalDevices - 1) / 2 - deviceIdx
  const newL = Math.max(10, Math.min(90, hsl.l + multiplier * 15))
  return hslToHex({ h: hsl.h, s: hsl.s, l: newL })
}

/* ---- SVG rendering ---- */

export interface ChartSvgInput {
  width: number
  height: number
  range: ResolvedRange
  leftMetric: Metric
  leftMetricLabel: string
  leftMetricUnit: string
  leftMetricColor: string
  leftSeries: SeriesPoints[]
  leftBounds: AxisBounds | null
  rightMetric: Metric | null
  rightMetricLabel: string | null
  rightMetricUnit: string | null
  rightMetricColor: string | null
  rightSeries: SeriesPoints[] | null
  rightBounds: AxisBounds | null
}

export function buildChartInput(
  axes: YAxisSpec,
  devices: DeviceSeries[],
  width: number,
  height: number,
  range: ResolvedRange,
): ChartSvgInput {
  const leftSeries = extractAxisSeries(devices, axes.left.key)
  const leftBounds = computeBounds(leftSeries, axes.left.key, axes.leftAuto)
  const rightSeries = axes.right ? extractAxisSeries(devices, axes.right.key) : null
  const rightBounds =
    axes.right && rightSeries ? computeBounds(rightSeries, axes.right.key, axes.rightAuto) : null
  return {
    width,
    height,
    range,
    leftMetric: axes.left.key,
    leftMetricLabel: axes.left.label,
    leftMetricUnit: axes.left.unit,
    leftMetricColor: axes.left.baseColor,
    leftSeries,
    leftBounds,
    rightMetric: axes.right?.key ?? null,
    rightMetricLabel: axes.right?.label ?? null,
    rightMetricUnit: axes.right?.unit ?? null,
    rightMetricColor: axes.right?.baseColor ?? null,
    rightSeries,
    rightBounds,
  }
}

export interface LegendEntry {
  deviceName: string
  leftColor: string | null
  rightColor: string | null
}

export function buildLegend(input: ChartSvgInput): LegendEntry[] {
  const total = (input.leftSeries ?? []).length
  return input.leftSeries.map((s, i) => ({
    deviceName: s.name,
    leftColor: deviceColor(input.leftMetricColor, i, total),
    rightColor: input.rightMetricColor ? deviceColor(input.rightMetricColor, i, total) : null,
  }))
}

/**
 * Plot padding inside the SVG — leaves room around the trace area so the
 * Satori HTML overlay (axis tick labels, x-axis time labels, axis
 * titles) lands in the correct gutters. Tick labels are *not* rendered
 * in the SVG itself because ResVG (workers-og's SVG→PNG stage) has no
 * font available and silently drops `<text>` elements.
 */
export const CHART_PAD = { top: 32, right: 76, bottom: 40, left: 76 }
const RAW_OPACITY = 0.35
const BAND_OPACITY = 0.18

/**
 * Pre-computed tick position for the HTML overlay. `frac` is the
 * fraction of the plot area from top (0) to bottom (1), so the overlay
 * can do `top: <frac * plotH + CHART_PAD.top>px`.
 */
export interface TickOverlay {
  value: number
  label: string
  /** 0 = top of plot area, 1 = bottom. */
  frac: number
}

export interface TimeTickOverlay {
  label: string
  /** 0 = left edge of plot area, 1 = right edge. */
  frac: number
}

export interface ChartOverlay {
  leftTicks: TickOverlay[]
  rightTicks: TickOverlay[]
  timeTicks: TimeTickOverlay[]
}

export function buildChartOverlay(input: ChartSvgInput): ChartOverlay {
  const leftTicks: TickOverlay[] = input.leftBounds
    ? input.leftBounds.ticks.map(v => ({
        value: v,
        label: fmtTick(v, input.leftMetric),
        frac: 1 - (v - input.leftBounds!.min) / (input.leftBounds!.max - input.leftBounds!.min),
      }))
    : []
  const rightTicks: TickOverlay[] = input.rightBounds && input.rightMetric
    ? input.rightBounds.ticks.map(v => ({
        value: v,
        label: fmtTick(v, input.rightMetric!),
        frac: 1 - (v - input.rightBounds!.min) / (input.rightBounds!.max - input.rightBounds!.min),
      }))
    : []
  const tSpan = input.range.to.getTime() - input.range.from.getTime()
  const timeTicks: TimeTickOverlay[] = niceTimeTicks(input.range, 6).map(d => ({
    label: fmtTimeLabel(d, input.range),
    frac: (d.getTime() - input.range.from.getTime()) / tSpan,
  })).filter(t => t.frac >= 0.01 && t.frac <= 0.99)
  return { leftTicks, rightTicks, timeTicks }
}

export function renderChartSvg(input: ChartSvgInput): string {
  const { width: W, height: H, range, leftSeries, leftBounds, rightSeries, rightBounds } = input
  const plotW = W - CHART_PAD.left - CHART_PAD.right
  const plotH = H - CHART_PAD.top - CHART_PAD.bottom
  const tSpan = range.to.getTime() - range.from.getTime()
  const xAt = (t: number) => CHART_PAD.left + ((t - range.from.getTime()) / tSpan) * plotW
  const yAt = (v: number, b: AxisBounds) =>
    CHART_PAD.top + plotH - ((v - b.min) / (b.max - b.min)) * plotH

  const parts: string[] = []

  // Card bg + plot frame
  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#1a1a1a" rx="14"/>`)
  parts.push(
    `<rect x="${CHART_PAD.left}" y="${CHART_PAD.top}" width="${plotW}" height="${plotH}" fill="#121214" stroke="#2a2a2a" stroke-width="1"/>`,
  )

  // Y-axis grid (lines only — tick *labels* are in the HTML overlay)
  if (leftBounds) {
    parts.push(yGrid(leftBounds, plotW, yAt, '#262629'))
  }

  // Traces — render σ band first, then raw, then smoothed, per axis.
  // Right axis drawn first so left axis overlays it (left = primary).
  const totalDevices = leftSeries.length
  if (rightBounds && rightSeries && input.rightMetricColor) {
    parts.push(
      renderTraces(rightSeries, rightBounds, input.rightMetricColor, totalDevices, xAt, yAt),
    )
  }
  if (leftBounds) {
    parts.push(
      renderTraces(leftSeries, leftBounds, input.leftMetricColor, totalDevices, xAt, yAt),
    )
  }

  return wrap(W, H, parts.join(''))
}

function renderTraces(
  series: SeriesPoints[],
  bounds: AxisBounds,
  baseColor: string,
  totalDevices: number,
  xAt: (t: number) => number,
  yAt: (v: number, b: AxisBounds) => number,
): string {
  const parts: string[] = []
  // σ bands first (lowest layer)
  for (let i = 0; i < series.length; i++) {
    const color = deviceColor(baseColor, i, totalDevices)
    parts.push(bandPath(series[i], bounds, color, xAt, yAt))
  }
  // Raw lines (thin, low opacity)
  for (let i = 0; i < series.length; i++) {
    const color = deviceColor(baseColor, i, totalDevices)
    parts.push(linePath(series[i].points, p => p.raw, bounds, color, 1, RAW_OPACITY, xAt, yAt))
  }
  // Smoothed (thick)
  for (let i = 0; i < series.length; i++) {
    const color = deviceColor(baseColor, i, totalDevices)
    parts.push(linePath(series[i].points, p => p.smooth, bounds, color, 3, 1, xAt, yAt))
  }
  return parts.join('')
}

function bandPath(
  s: SeriesPoints,
  bounds: AxisBounds,
  color: string,
  xAt: (t: number) => number,
  yAt: (v: number, b: AxisBounds) => number,
): string {
  const upperSeg: string[][] = [[]]
  const lowerSeg: string[][] = [[]]
  let active = false
  for (const p of s.points) {
    if (p.smooth === null || p.std === null) {
      if (active) {
        upperSeg.push([]); lowerSeg.push([])
        active = false
      }
      continue
    }
    const x = xAt(p.t).toFixed(1)
    const yu = yAt(p.smooth + p.std, bounds).toFixed(1)
    const yl = yAt(p.smooth - p.std, bounds).toFixed(1)
    upperSeg[upperSeg.length - 1].push(`${x},${yu}`)
    lowerSeg[lowerSeg.length - 1].push(`${x},${yl}`)
    active = true
  }
  const out: string[] = []
  for (let i = 0; i < upperSeg.length; i++) {
    const up = upperSeg[i]
    const lo = lowerSeg[i].slice().reverse()
    if (up.length < 2) continue
    out.push(
      `<polygon points="${up.concat(lo).join(' ')}" fill="${color}" fill-opacity="${BAND_OPACITY}"/>`,
    )
  }
  return out.join('')
}

function linePath(
  points: SeriesPoints['points'],
  pick: (p: SeriesPoints['points'][number]) => number | null,
  bounds: AxisBounds,
  color: string,
  width: number,
  opacity: number,
  xAt: (t: number) => number,
  yAt: (v: number, b: AxisBounds) => number,
): string {
  const segs: string[][] = [[]]
  for (const p of points) {
    const v = pick(p)
    if (v === null) {
      if (segs[segs.length - 1].length > 0) segs.push([])
      continue
    }
    segs[segs.length - 1].push(`${xAt(p.t).toFixed(1)},${yAt(v, bounds).toFixed(1)}`)
  }
  const out: string[] = []
  for (const seg of segs) {
    if (seg.length < 2) continue
    out.push(
      `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" stroke-opacity="${opacity}"/>`,
    )
  }
  return out.join('')
}

function yGrid(
  bounds: AxisBounds,
  plotW: number,
  yAt: (v: number, b: AxisBounds) => number,
  color: string,
): string {
  return bounds.ticks
    .map(t => {
      const y = yAt(t, bounds).toFixed(1)
      return `<line x1="${CHART_PAD.left}" y1="${y}" x2="${CHART_PAD.left + plotW}" y2="${y}" stroke="${color}" stroke-width="1"/>`
    })
    .join('')
}

/**
 * Pick ~`target` nice-rounded time ticks across [from, to). Step snaps to
 * 1/5/15/30 min, 1/2/3/6/12 hr, 1/2/7/14 d.
 */
function niceTimeTicks(range: ResolvedRange, target: number): Date[] {
  const span = range.to.getTime() - range.from.getTime()
  const candidates = [
    60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000,
    60 * 60_000, 2 * 3_600_000, 3 * 3_600_000, 6 * 3_600_000, 12 * 3_600_000,
    86_400_000, 2 * 86_400_000, 7 * 86_400_000, 14 * 86_400_000,
  ]
  const ideal = span / target
  let step = candidates[0]
  for (const c of candidates) {
    if (Math.abs(c - ideal) < Math.abs(step - ideal)) step = c
  }
  const ticks: Date[] = []
  // Floor to nearest step boundary in UTC.
  const first = Math.ceil(range.from.getTime() / step) * step
  for (let t = first; t < range.to.getTime(); t += step) ticks.push(new Date(t))
  return ticks
}

function fmtTimeLabel(d: Date, range: ResolvedRange): string {
  const spanMs = range.to.getTime() - range.from.getTime()
  const oneDay = 86_400_000
  if (spanMs > 7 * oneDay) {
    // Multi-week: show date only.
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
  }
  if (spanMs > oneDay) {
    // 1d–7d: show month/day + hour.
    const hh = String(d.getUTCHours()).padStart(2, '0')
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}h`
  }
  // ≤1d: show hour:minute.
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}


function wrap(W: number, H: number, body: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    body +
    `</svg>`
  return `data:image/svg+xml;base64,${b64(svg)}`
}

function b64(s: string): string {
  // `btoa` only accepts Latin-1 codepoints; the SVG may carry non-ASCII
  // glyphs (CO₂ subscript, °F, µg/m³, etc.). UTF-8 encode first, then
  // pack to a Latin-1-safe string for `btoa`.
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
