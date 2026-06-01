/**
 * Vanilla-DOM error overlay — bulletproof crash surfacing for mobile.
 *
 * React can leave the page blank when a render throws (especially in
 * StrictMode where the error fires twice). On a desktop you'd open
 * devtools; on iPad/Android there's no console, just a black screen.
 *
 * This module wires `window.error` + `unhandledrejection` to a fixed
 * fixed-position div that renders the most recent N errors with full
 * stacks. It's pure DOM (no React, no shadow root) so it survives even
 * if the React tree has fully unmounted.
 *
 * Toggle on with `?dbg` in the URL (no value needed, like `?og`).
 * Strictly URL-driven — no localStorage stickiness, so removing the
 * param immediately disables the overlay on the next load.
 *
 * The overlay is collapsed by default (small red badge in the corner
 * showing the error count); tap to expand.
 */

const MAX_ERRORS = 20

interface CapturedError {
  ts: number
  kind: 'error' | 'unhandledrejection' | 'log'
  message: string
  stack?: string
  filename?: string
  lineno?: number
  colno?: number
}

let installed = false
const errors: CapturedError[] = []
let overlayRoot: HTMLDivElement | null = null
let badgeEl: HTMLDivElement | null = null
let listEl: HTMLDivElement | null = null
let expanded = false

function shouldEnable(): boolean {
  if (typeof window === 'undefined') return false
  // Presence-as-true, like `?og` (use-prms `boolParam`). Any value is fine
  // (`?dbg`, `?dbg=1`, `?dbg=foo` all enable); only absence disables.
  return new URLSearchParams(window.location.search).has('dbg')
}

export function installErrorOverlay(): void {
  if (installed || typeof window === 'undefined') return
  if (!shouldEnable()) return
  installed = true

  window.addEventListener('error', (ev) => {
    capture({
      ts: Date.now(),
      kind: 'error',
      message: ev.message ?? String(ev.error),
      stack: ev.error?.stack,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
    })
  })

  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    capture({
      ts: Date.now(),
      kind: 'unhandledrejection',
      message: typeof r === 'string' ? r : r?.message ?? JSON.stringify(r),
      stack: r?.stack,
    })
  })

  // Mirror console.{error,warn,log,info} into the overlay so we can see
  // app-side logs (device fetch, pyrmts response sizes, smart-poll cycle,
  // …) without a remote DevTools attached — critical on mobile where the
  // page is blank but we need to see *why*.
  const mirror = (level: 'error' | 'warn' | 'log' | 'info', orig: (...args: unknown[]) => void) => {
    return (...args: unknown[]) => {
      orig.apply(console, args)
      const message = args
        .map(a => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : safeJson(a)))
        .join(' ')
      capture({ ts: Date.now(), kind: level === 'error' ? 'error' : 'log', message })
    }
  }
  console.error = mirror('error', console.error)
  console.warn = mirror('warn', console.warn)
  console.log = mirror('log', console.log)
  console.info = mirror('info', console.info)

  // Defer DOM mount until <body> exists.
  if (document.body) mountOverlay()
  else document.addEventListener('DOMContentLoaded', mountOverlay, { once: true })
}

function capture(e: CapturedError): void {
  errors.unshift(e)
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS
  renderOverlay()
}

function mountOverlay(): void {
  if (overlayRoot) return
  overlayRoot = document.createElement('div')
  overlayRoot.id = 'awair-debug-overlay'
  Object.assign(overlayRoot.style, {
    position: 'fixed',
    bottom: '12px',
    left: '12px',
    zIndex: '2147483647',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    color: '#fff',
    pointerEvents: 'auto',
  } satisfies Partial<CSSStyleDeclaration>)

  badgeEl = document.createElement('div')
  Object.assign(badgeEl.style, {
    padding: '6px 10px',
    background: 'rgba(220,40,40,0.95)',
    borderRadius: '12px',
    cursor: 'pointer',
    userSelect: 'none',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  } satisfies Partial<CSSStyleDeclaration>)
  badgeEl.textContent = '🐞 debug'
  badgeEl.addEventListener('click', () => {
    expanded = !expanded
    renderOverlay()
  })

  listEl = document.createElement('div')
  Object.assign(listEl.style, {
    display: 'none',
    marginTop: '8px',
    maxWidth: 'min(720px, calc(100vw - 24px))',
    maxHeight: '60vh',
    overflow: 'auto',
    background: 'rgba(0,0,0,0.92)',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '10px',
    lineHeight: '1.4',
  } satisfies Partial<CSSStyleDeclaration>)

  overlayRoot.appendChild(badgeEl)
  overlayRoot.appendChild(listEl)
  document.body.appendChild(overlayRoot)
  renderOverlay()
}

function renderOverlay(): void {
  if (!badgeEl || !listEl) return
  const n = errors.length
  badgeEl.textContent = n === 0 ? '🐞 debug' : `🐞 ${n}`
  badgeEl.style.background = n === 0 ? 'rgba(60,60,60,0.9)' : 'rgba(220,40,40,0.95)'
  if (!expanded) {
    listEl.style.display = 'none'
    return
  }
  listEl.style.display = 'block'
  // Header: build a fresh fragment each render.
  listEl.replaceChildren()
  const head = document.createElement('div')
  head.style.borderBottom = '1px solid #333'
  head.style.paddingBottom = '6px'
  head.style.marginBottom = '8px'
  head.style.display = 'flex'
  head.style.justifyContent = 'space-between'
  head.style.alignItems = 'center'
  head.style.gap = '8px'
  const title = document.createElement('div')
  title.textContent = `errors (${n})`
  title.style.fontWeight = '600'
  const ua = document.createElement('div')
  ua.textContent = `${navigator.userAgent.slice(0, 80)} · vw=${window.innerWidth}`
  ua.style.color = '#888'
  ua.style.fontSize = '11px'
  const actions = document.createElement('div')
  actions.style.display = 'flex'
  actions.style.gap = '6px'
  const clearBtn = makeBtn('clear', () => { errors.length = 0; renderOverlay() })
  const copyBtn = makeBtn('copy', () => {
    const text = errors.map(formatError).join('\n\n---\n\n')
    navigator.clipboard?.writeText(text).catch(() => {})
    copyBtn.textContent = 'copied'
    setTimeout(() => { copyBtn.textContent = 'copy' }, 1500)
  })
  // `off` strips `?dbg` from the URL and reloads, mirroring how you'd
  // turn it off externally. Just removing the overlay DOM would leave
  // the param in the URL and reappear on reload.
  const offBtn = makeBtn('off', () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('dbg')
    window.location.href = url.toString()
  })
  actions.append(clearBtn, copyBtn, offBtn)
  head.append(title, ua, actions)
  listEl.appendChild(head)

  for (const e of errors) {
    const row = document.createElement('div')
    row.style.marginBottom = '10px'
    row.style.borderLeft = e.kind === 'log' ? '3px solid #888' : '3px solid #d44'
    row.style.paddingLeft = '8px'
    const meta = document.createElement('div')
    meta.style.color = '#aaa'
    meta.style.fontSize = '10px'
    const dt = new Date(e.ts)
    const hh = String(dt.getHours()).padStart(2, '0')
    const mm = String(dt.getMinutes()).padStart(2, '0')
    const ss = String(dt.getSeconds()).padStart(2, '0')
    meta.textContent = `${hh}:${mm}:${ss} · ${e.kind}${e.filename ? ` · ${e.filename}:${e.lineno}:${e.colno}` : ''}`
    const body = document.createElement('pre')
    body.style.margin = '4px 0 0'
    body.style.whiteSpace = 'pre-wrap'
    body.style.wordBreak = 'break-word'
    body.style.color = '#fff'
    body.textContent = formatError(e)
    row.append(meta, body)
    listEl.appendChild(row)
  }
}

function makeBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.textContent = label
  Object.assign(btn.style, {
    background: '#2a2a2a',
    color: '#fff',
    border: '1px solid #444',
    borderRadius: '4px',
    padding: '2px 8px',
    fontSize: '11px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  } satisfies Partial<CSSStyleDeclaration>)
  btn.addEventListener('click', onClick)
  return btn
}

function formatError(e: CapturedError): string {
  if (e.stack) return e.stack
  return e.message
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}
