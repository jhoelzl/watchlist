import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './', // relative paths so the app also works under /<repo>/ on GitHub Pages
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
})
