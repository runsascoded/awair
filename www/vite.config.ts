import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5150,
    // Allow Docker container to access dev server
    allowedHosts: ['host.docker.internal'],
  },
  resolve: {
    alias: {
      // Use plotly-basic (smaller bundle) from fixed GitHub branch
      // https://github.com/plotly/plotly.js/pull/7659
      'plotly.js/dist/plotly': 'plotly.js/dist/plotly-basic.min.js',
      'plotly.js-dist-min': 'plotly.js/dist/plotly-basic.min.js',
    },
  },
})
