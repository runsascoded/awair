import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Exclude local file: dependencies from pre-bundling for easier development
    exclude: ['use-url-params'],
  },
})
