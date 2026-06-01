/// <reference types="@cloudflare/workers-types" />

import { ImageResponse } from 'workers-og'
import {
  OG_H,
  OG_W,
  formatDevices,
  formatSmoothing,
  formatTimeRange,
  formatYAxes,
  parseOgParams,
} from './_lib/og-card'
import {
  buildChartInput,
  buildChartOverlay,
  buildLegend,
  CHART_PAD,
  decodeTimeRange,
  decodeYAxes,
  fetchDeviceSeries,
  renderChartSvg,
  resolveDeviceIds,
  type ChartOverlay,
} from './_lib/og-chart'

/**
 * Dynamic OG image for any awair view. Renders a 1200×630 card with the
 * metrics + devices + time range encoded in the request query string,
 * plus a dual-Y, σ-banded, raw+smoothed chart traced from live pyrmts
 * data. Colors and HSL-nudge mirror the live Plotly chart.
 *
 * Satori (inside `workers-og`) requires every element with >1 child to
 * declare `display:flex` and treats inter-tag whitespace as text nodes,
 * so the markup is built whitespace-free with `flex` on every wrapping
 * div. Inline `<svg>` isn't supported; the chart goes through `<img src=
 * data:image/svg+xml;...>`.
 *
 * Cache: keyed on URL (path + sorted query), TTL 5 min. Crawler bursts
 * hit cache; share-link previews don't refetch pyrmts for every Slack/
 * iMessage view.
 *
 * Fallback: pyrmts errors render the headline-only card so the share
 * unfurl still works during awair-serve outages.
 */
const CACHE_TTL_S = 300

// Chart sizing — tuned for the live-chart-style layout below.
const CARD_PAD_X = 32
const CARD_PAD_Y = 24
const HEADER_H = 36
const TITLE_H = 64
const LEGEND_H = 36
const CHART_H = OG_H - CARD_PAD_Y * 2 - HEADER_H - TITLE_H - LEGEND_H
const CHART_W = OG_W - CARD_PAD_X * 2

let fontPromise: Promise<ArrayBuffer> | null = null
function loadFont(): Promise<ArrayBuffer> {
  if (!fontPromise) {
    fontPromise = fetch(
      'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff',
    ).then(r => r.arrayBuffer())
  }
  return fontPromise
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const div = (style: string, inner = ''): string =>
  `<div style="display:flex;${style}">${inner}</div>`

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url)
  const cacheKey = new Request(url.toString(), { method: 'GET' })
  const cache = caches.default

  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const params = parseOgParams(url.searchParams)
  const axes = decodeYAxes(params.yAxes)
  const range = decodeTimeRange(params.timeRange)
  const deviceIds = resolveDeviceIds(params.devices)

  let chartSvgDataUrl: string | null = null
  let legendHtml = ''
  let overlay: ChartOverlay | null = null
  let leftAxisTitle: string | null = null
  let rightAxisTitle: string | null = null
  try {
    const devices = await fetchDeviceSeries(deviceIds, range, params.smoothing, 120)
    const chartInput = buildChartInput(axes, devices, CHART_W, CHART_H, range)
    chartSvgDataUrl = renderChartSvg(chartInput)
    legendHtml = renderLegend(buildLegend(chartInput))
    overlay = buildChartOverlay(chartInput)
    leftAxisTitle = `${chartInput.leftMetricLabel} (${chartInput.leftMetricUnit})`
    if (chartInput.rightMetricLabel) {
      rightAxisTitle = `${chartInput.rightMetricLabel} (${chartInput.rightMetricUnit ?? ''})`
    }
  } catch (e) {
    console.error('OG chart fetch failed:', e)
  }

  const html = renderCard({
    yLabel: formatYAxes(params.yAxes),
    deviceLabel: formatDevices(params.devices),
    rangeLabel: formatTimeRange(params.timeRange),
    smoothLabel: formatSmoothing(params.smoothing),
    chartSvgDataUrl,
    legendHtml,
    overlay,
    leftAxisTitle,
    rightAxisTitle,
    leftMetricColor: axes.left.baseColor,
    rightMetricColor: axes.right?.baseColor ?? null,
  })

  const fontData = await loadFont()
  const resp = new ImageResponse(html, {
    width: OG_W,
    height: OG_H,
    fonts: [{ name: 'Inter', data: fontData, weight: 700, style: 'normal' }],
  }) as unknown as Response

  // Response bodies are one-shot; tee for cache + return.
  const buf = await resp.arrayBuffer()
  const cacheable = new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': `public, max-age=${CACHE_TTL_S}, s-maxage=${CACHE_TTL_S}`,
    },
  })
  ctx.waitUntil(cache.put(cacheKey, cacheable.clone()))
  return cacheable
}

interface CardData {
  yLabel: string
  deviceLabel: string
  rangeLabel: string
  smoothLabel: string
  chartSvgDataUrl: string | null
  legendHtml: string
  overlay: ChartOverlay | null
  leftAxisTitle: string | null
  rightAxisTitle: string | null
  leftMetricColor: string
  rightMetricColor: string | null
}

function renderCard(d: CardData): string {
  return div(
    `width:${OG_W}px;height:${OG_H}px;background:#121212;color:#fafafa;` +
      `padding:${CARD_PAD_Y}px ${CARD_PAD_X}px;font-family:'Inter',sans-serif;` +
      `flex-direction:column;`,
    header() + title(d) + (d.legendHtml || legendPlaceholder()) + chartArea(d),
  )
}

function header(): string {
  return div(
    `flex-direction:row;align-items:center;justify-content:space-between;height:${HEADER_H}px;`,
    `<span style="display:flex;font-size:18px;letter-spacing:4px;color:#888;">AWAIR · AIR QUALITY</span>` +
      `<span style="display:flex;font-size:18px;color:#888;">air.rbw.sh</span>`,
  )
}

function title(d: CardData): string {
  return div(
    `flex-direction:row;align-items:flex-end;justify-content:space-between;height:${TITLE_H}px;`,
    div(
      'flex-direction:row;align-items:baseline;gap:18px;',
      `<span style="display:flex;font-size:42px;line-height:1;color:#fafafa;">${escapeHtml(d.yLabel)}</span>` +
        `<span style="display:flex;font-size:22px;color:#aaaaaa;">${escapeHtml(d.deviceLabel)}</span>`,
    ) +
      div(
        'flex-direction:row;align-items:center;gap:10px;',
        chip(d.rangeLabel) + chip(d.smoothLabel),
      ),
  )
}

function chip(text: string): string {
  return (
    `<span style="display:flex;font-size:18px;color:#fafafa;padding:6px 14px;` +
    `border:1px solid #444;border-radius:999px;background:#1e1e1e;">${escapeHtml(text)}</span>`
  )
}

interface LegendItem {
  deviceName: string
  leftColor: string | null
  rightColor: string | null
}

function renderLegend(items: LegendItem[]): string {
  const swatches = items
    .map(it => {
      const leftSwatch = it.leftColor
        ? `<span style="display:flex;width:16px;height:16px;border-radius:8px;background:${it.leftColor};"></span>`
        : ''
      const rightSwatch = it.rightColor
        ? `<span style="display:flex;width:16px;height:16px;border-radius:8px;background:${it.rightColor};margin-left:4px;"></span>`
        : ''
      return div(
        'flex-direction:row;align-items:center;gap:6px;',
        leftSwatch +
          rightSwatch +
          `<span style="display:flex;font-size:18px;color:#dddddd;margin-left:8px;">${escapeHtml(it.deviceName)}</span>`,
      )
    })
    .join('')
  return div(
    `flex-direction:row;align-items:center;justify-content:flex-start;gap:24px;height:${LEGEND_H}px;`,
    swatches,
  )
}

function legendPlaceholder(): string {
  return div(`flex-direction:row;height:${LEGEND_H}px;`, '')
}

function chartArea(d: CardData): string {
  if (!d.chartSvgDataUrl) {
    return div(
      `width:${CHART_W}px;height:${CHART_H}px;background:#1a1a1a;border-radius:14px;` +
        `align-items:center;justify-content:center;color:#666;font-size:24px;`,
      'No data available',
    )
  }
  // Wrap the SVG chart in a position:relative container so we can absolutely
  // position axis tick labels + time labels on top of it (ResVG can't render
  // <text> without a font, so all text lives in HTML).
  const img = `<img src="${d.chartSvgDataUrl}" width="${CHART_W}" height="${CHART_H}" style="position:absolute;top:0;left:0;"/>`
  return div(
    `position:relative;width:${CHART_W}px;height:${CHART_H}px;`,
    img + overlayHtml(d),
  )
}

function overlayHtml(d: CardData): string {
  if (!d.overlay) return ''
  const parts: string[] = []

  // Plot area dimensions inside the SVG (matches CHART_PAD in og-chart.ts).
  const plotTop = CHART_PAD.top
  const plotBottom = CHART_H - CHART_PAD.bottom
  const plotH = plotBottom - plotTop
  const plotLeft = CHART_PAD.left
  const plotRight = CHART_W - CHART_PAD.right
  const plotW = plotRight - plotLeft

  // Axis title — top of each axis, colored with the metric base color.
  if (d.leftAxisTitle) {
    parts.push(
      `<span style="position:absolute;left:${plotLeft}px;top:6px;color:${d.leftMetricColor};font-size:18px;font-weight:700;">${escapeHtml(d.leftAxisTitle)}</span>`,
    )
  }
  if (d.rightAxisTitle && d.rightMetricColor) {
    parts.push(
      `<span style="position:absolute;right:${CHART_W - plotRight}px;top:6px;color:${d.rightMetricColor};font-size:18px;font-weight:700;">${escapeHtml(d.rightAxisTitle)}</span>`,
    )
  }

  // Y-tick labels — left edge.
  for (const t of d.overlay.leftTicks) {
    const top = plotTop + t.frac * plotH - 11
    parts.push(
      `<span style="position:absolute;right:${CHART_W - plotLeft + 8}px;top:${top.toFixed(1)}px;color:${d.leftMetricColor};font-size:16px;font-weight:700;">${escapeHtml(t.label)}</span>`,
    )
  }
  // Y-tick labels — right edge.
  if (d.rightMetricColor) {
    for (const t of d.overlay.rightTicks) {
      const top = plotTop + t.frac * plotH - 11
      parts.push(
        `<span style="position:absolute;left:${plotRight + 8}px;top:${top.toFixed(1)}px;color:${d.rightMetricColor};font-size:16px;font-weight:700;">${escapeHtml(t.label)}</span>`,
      )
    }
  }

  // X-axis time labels — below plot.
  for (const t of d.overlay.timeTicks) {
    const left = plotLeft + t.frac * plotW
    // Approx half-width per char @ 15px font ≈ 4.5px.
    const offset = (t.label.length * 4.5)
    parts.push(
      `<span style="position:absolute;left:${(left - offset).toFixed(1)}px;top:${(plotBottom + 8).toFixed(1)}px;color:#cccccc;font-size:15px;">${escapeHtml(t.label)}</span>`,
    )
  }
  return parts.join('')
}
