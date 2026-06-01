import { PlotlyProvider } from 'pltly'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'uplot/dist/uPlot.min.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorOverlay } from './lib/errorOverlay'

// Install vanilla-DOM error overlay first so it can catch errors thrown
// during the very first render. Opt-in via `?dbg` (URL-only, no
// localStorage stickiness). See `lib/errorOverlay.ts`.
installErrorOverlay()

// Use plotly.js's tree-shakeable factory; includes scatter + fx + colorscale
// essentials by default. Avoids pulling in the `image` trace (and its
// `probe-image-size` → node `stream` dep, which vite can't resolve).
const loadPlotly = () =>
  import('plotly.js/factory').then(({ createPlotly }) => createPlotly())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <PlotlyProvider loader={loadPlotly} deferAutoMargin>
        <App />
      </PlotlyProvider>
    </ErrorBoundary>
  </StrictMode>,
)
