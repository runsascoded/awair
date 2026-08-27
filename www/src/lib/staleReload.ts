/**
 * Self-heal a tab left running a stale build.
 *
 * Asset filenames are content-hashed, so every deploy replaces them. A
 * tab still running a previous build asks for hashes that no longer
 * exist — and `public/_redirects` (`/*  /index.html  200`) answers that
 * miss with index.html rather than a 404, so the browser reports:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module
 *   script but the server responded with a MIME type of "text/html".
 *
 * The page is then half-alive: data still fetches (the main bundle is
 * already running) but the lazy `plotly.js/factory` chunk never
 * arrives, so the chart stays blank with no visible error. A manual
 * refresh fixes it; this does that refresh automatically.
 *
 * Guarded by a `sessionStorage` stamp so a genuinely broken deploy
 * degrades to "broken once" rather than an infinite reload loop.
 */

const STAMP_KEY = 'awair:stale-reload'

/** Two reloads this close together mean a loop, not staleness. */
export const COOLDOWN_MS = 30_000

export interface StaleReloadDeps {
  reload: () => void
  now: () => number
  /** `null` when the browser denies storage (private mode, blocked cookies). */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  origin: string
}

/**
 * Is this one of our own content-hashed build artifacts? Third-party
 * scripts (analytics, extensions) fail all the time and reloading
 * wouldn't fix them.
 */
export function isOwnAssetUrl(url: string | null | undefined, origin: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url, origin)
    return u.origin === origin && u.pathname.startsWith('/assets/')
  } catch {
    return false
  }
}

function reloadOnce(deps: StaleReloadDeps): boolean {
  const { storage, now, reload } = deps
  // Without persistent storage there's no way to detect a loop across
  // reloads, and looping is worse than staying stale — the user can
  // still refresh by hand.
  if (!storage) {
    console.warn('🔁 Stale asset detected, but sessionStorage is unavailable — refresh to recover')
    return false
  }
  try {
    const last = Number(storage.getItem(STAMP_KEY) ?? 0)
    if (last && now() - last < COOLDOWN_MS) return false
    storage.setItem(STAMP_KEY, String(now()))
  } catch {
    console.warn('🔁 Stale asset detected, but sessionStorage threw — refresh to recover')
    return false
  }
  console.warn('🔁 Stale build detected (asset 404 → SPA fallback); reloading')
  reload()
  return true
}

function defaultDeps(): StaleReloadDeps {
  let storage: StaleReloadDeps['storage'] = null
  try {
    storage = window.sessionStorage
  } catch {
    storage = null
  }
  return {
    reload: () => window.location.reload(),
    now: () => Date.now(),
    storage,
    origin: window.location.origin,
  }
}

export function installStaleAssetReload(overrides: Partial<StaleReloadDeps> = {}): () => void {
  const deps = { ...defaultDeps(), ...overrides }

  // Vite wraps built dynamic imports in `__vitePreload`, which dispatches
  // this before rethrowing. Always our own chunk, so no URL check.
  const onPreloadError = () => { reloadOnce(deps) }

  // `<link>`/`<script>` load failures don't bubble, hence capture phase.
  const onResourceError = (e: Event) => {
    const el = e.target
    const url = el instanceof HTMLLinkElement ? el.href
      : el instanceof HTMLScriptElement ? el.src
        : null
    if (isOwnAssetUrl(url, deps.origin)) reloadOnce(deps)
  }

  window.addEventListener('vite:preloadError', onPreloadError)
  window.addEventListener('error', onResourceError, true)

  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError)
    window.removeEventListener('error', onResourceError, true)
  }
}
