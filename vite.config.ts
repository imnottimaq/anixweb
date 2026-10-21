import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { offlineShell } from './scripts/offlineShell.ts'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), offlineShell()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/anime4k-webgpu')) {
            return 'anime4k';
          }
          if (id.includes('node_modules/hls.js')) {
            return 'hls';
          }
        },
      },
    },
  },
})
