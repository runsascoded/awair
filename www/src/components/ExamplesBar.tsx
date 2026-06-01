/**
 * `ExamplesBar` — chip row of curated URL views, rendered below the chart.
 * Demonstrates a few of the more interesting param combinations so first-time
 * visitors don't land on the bare default and bounce.
 *
 * Each chip is a regular `<a>` so middle-click / cmd-click open in a new tab.
 * Same-tab clicks intercept and use `history.pushState` so the SPA params
 * update without a full reload.
 */

interface Example {
  label: string
  search: string
  description?: string
}

const EXAMPLES: readonly Example[] = [
  {
    label: 'Temp + Humidity · 1d · 3h smooth',
    search: '?y=thaA&s=3h&t=-24h&d=br+desk',
    description: 'BR + Desk, both autoscaled axes',
  },
  {
    label: 'PM2.5 + VOC · 30d · 1d smooth',
    search: '?y=pvaA&s=1d&t=-30d&d=br+desk+gym+rt',
    description: 'All 4 devices, both autoscaled',
  },
] as const

function applyExample(search: string) {
  const url = new URL(window.location.href)
  url.search = search.startsWith('?') ? search.slice(1) : search
  window.history.pushState({}, '', url.toString())
  // Notify use-prms / any URL-state listeners (use-prms hooks `popstate`).
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function ExamplesBar() {
  return (
    <div className="examples-bar">
      <span className="label">Examples:</span>
      {EXAMPLES.map(ex => (
        <a
          key={ex.search}
          href={ex.search}
          className="example-chip"
          title={ex.description}
          onClick={e => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
            e.preventDefault()
            applyExample(ex.search)
          }}
        >
          {ex.label}
        </a>
      ))}
    </div>
  )
}
