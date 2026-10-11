import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/ui/setup.ts'],
    include: ['tests/ui/**/*.test.{ts,tsx}'],
    exclude: [
      'tests/*.test.mjs',
      'tests/**/*.mjs',
      'node_modules/**',
      'dist/**',
      'tests/e2e/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/index.css',
      ],
    },
  },
})
