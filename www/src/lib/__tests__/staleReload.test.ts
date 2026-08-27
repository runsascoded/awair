import { afterEach, describe, expect, it, vi } from 'vitest'
import { COOLDOWN_MS, installStaleAssetReload, isOwnAssetUrl, type StaleReloadDeps } from '../staleReload'

const ORIGIN = 'https://air.rbw.sh'

/** In-memory stand-in for `sessionStorage`, so cooldown state is per-test. */
function memStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
  }
}

interface Harness {
  reloads: number[]
  advance: (ms: number) => void
  uninstall: () => void
}

function install(overrides: Partial<StaleReloadDeps> = {}): Harness {
  const reloads: number[] = []
  let clock = 1_000_000
  const uninstall = installStaleAssetReload({
    origin: ORIGIN,
    storage: memStorage(),
    now: () => clock,
    reload: () => { reloads.push(clock) },
    ...overrides,
  })
  return { reloads, advance: (ms) => { clock += ms }, uninstall }
}

/** Attached so the capture-phase listener on `window` sees the event. */
function failStylesheet(href: string): void {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
  link.dispatchEvent(new Event('error'))
  link.remove()
}

function failScript(src: string): void {
  const script = document.createElement('script')
  script.src = src
  document.head.appendChild(script)
  script.dispatchEvent(new Event('error'))
  script.remove()
}

const preloadError = () => window.dispatchEvent(new Event('vite:preloadError'))

describe('isOwnAssetUrl', () => {
  it('accepts only same-origin build artifacts', () => {
    const cases = [
      '/assets/factory-CGWlElYr.js',
      `${ORIGIN}/assets/index-DY4uF_HV.css`,
      '/devices.parquet',
      `${ORIGIN}/health`,
      'https://cdn.example.com/assets/thing.js',
      'not a url',
      '',
      null,
      undefined,
    ]
    expect(cases.map((c) => isOwnAssetUrl(c, ORIGIN))).toEqual([
      true, true, false, false, false, false, false, false, false,
    ])
  })
})

describe('installStaleAssetReload', () => {
  let active: Harness | null = null
  afterEach(() => { active?.uninstall(); active = null })

  it('reloads when a lazy chunk fails to load', () => {
    active = install()
    preloadError()
    expect(active.reloads).toEqual([1_000_000])
  })

  it('reloads when one of our stylesheets fails', () => {
    active = install()
    failStylesheet(`${ORIGIN}/assets/index-DY4uF_HV.css`)
    expect(active.reloads).toEqual([1_000_000])
  })

  it('ignores third-party resource failures', () => {
    active = install()
    failScript('https://cdn.example.com/analytics.js')
    failStylesheet('https://fonts.example.com/x.css')
    expect(active.reloads).toEqual([])
  })

  it('reloads at most once per cooldown, then heals again later', () => {
    active = install()
    preloadError()
    active.advance(COOLDOWN_MS - 1)
    preloadError()   // still within cooldown — a loop, not staleness
    active.advance(1)
    preloadError()   // cooldown elapsed — a later deploy may go stale too
    expect(active.reloads).toEqual([1_000_000, 1_000_000 + COOLDOWN_MS])
  })

  it('stays stale rather than risking a loop when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    active = install({ storage: null })
    preloadError()
    expect(active.reloads).toEqual([])
    expect(warn.mock.calls).toEqual([
      ['🔁 Stale asset detected, but sessionStorage is unavailable — refresh to recover'],
    ])
    warn.mockRestore()
  })

  it('stops listening once uninstalled', () => {
    const h = install()
    h.uninstall()
    preloadError()
    failStylesheet(`${ORIGIN}/assets/index-DY4uF_HV.css`)
    expect(h.reloads).toEqual([])
  })
})
