import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloudflare Pages (and most static hosts) expect the build output to live
// inside the build root directory. We default to `dist/` so a plain
// `npm run build` in CI / Cloudflare Pages just works. For local dev where you
// also want the site staged into the sibling `www/ratinghub` folder (alongside
// other projects in the `wmpc/` parent workspace), set
// `BUILD_OUT_DIR=../../www/ratinghub` when running the build — or use the
// `build:local` script defined in package.json.
const outDir = process.env.BUILD_OUT_DIR || 'dist'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir,
    emptyOutDir: true,
  },
})
