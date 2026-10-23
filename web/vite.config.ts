import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './', // relative Pfade, damit die App auch unter /<repo>/ auf GitHub Pages läuft
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
})
