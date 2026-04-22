/// <reference types="vite/client" />

declare module 'plotly.js/factory' {
  export function createPlotly(options?: {
    traces?: unknown[]
    components?: unknown[]
    Icons?: unknown
    Snapshot?: unknown
    PlotSchema?: unknown
  }): typeof import('plotly.js')
}
