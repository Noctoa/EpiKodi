import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['backend/**/*.test.ts', 'frontend/**/*.test.ts', 'shared/**/*.test.ts'],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@backend': resolve('backend'),
      '@shared': resolve('shared')
    }
  }
})
