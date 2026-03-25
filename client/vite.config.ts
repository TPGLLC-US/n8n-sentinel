import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // Load PORT from the monorepo root .env
  const rootEnv = loadEnv(mode, path.resolve(__dirname, '..'), '')
  const apiPort = rootEnv.PORT || '3000'
  const apiTarget = `http://localhost:${apiPort}`

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
        // Per-instance ingest paths: /<accountToken>/<instanceToken>/ingest
        '^/[a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+/ingest': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
