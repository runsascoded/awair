import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use fixed plotly.js from GitHub branch until PR is merged
      // https://github.com/plotly/plotly.js/pull/7659
      'plotly.js-dist-min': 'plotly.js/dist/plotly.min.js',
    },
  },
  optimizeDeps: {
    // Exclude local file: dependencies from pre-bundling for easier development
    exclude: ['use-url-params'],
  },
})
