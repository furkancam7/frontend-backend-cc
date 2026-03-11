import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Mapbox GL remains a large async-only chunk even after feature splitting.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('/mapbox-gl/')) return 'mapbox-core'
          if (id.includes('/react-map-gl/')) return 'mapbox-react'
          if (id.includes('/react-dom/')) return 'react-dom'
          if (id.includes('/react-router/') || id.includes('/react-router-dom/')) return 'router-vendor'
          if (id.includes('/react/')) return 'react-core'
          if (id.includes('/mqtt/')) return 'mqtt-vendor'
          if (id.includes('/three/')) return 'three-vendor'

          return 'vendor'
        }
      }
    },
    minify: 'esbuild',
  },
  esbuild: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  }
})
