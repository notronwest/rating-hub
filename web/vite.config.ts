import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Output to ../../www/ratinghub relative to web/
    // Resolves to: projects/www/ratinghub
    outDir: '../../www/ratinghub',
    emptyOutDir: true,
  },
})
