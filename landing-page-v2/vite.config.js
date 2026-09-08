import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 - the port this project has always been opened on - because in the
    // deployed site THIS is what lives at the root. The app moved to /app.
    port: 5173,
    strictPort: true,
    proxy: {
      // /app -> the apps/web dev server, so ONE origin in development serves the
      // same shape as the deploy: marketing at /, product at /app. Without this,
      // `npm run dev` gives you two unrelated ports and every path bug that only
      // appears under a prefix is invisible until it is deployed.
      //
      // ws: true forwards Vite's HMR socket as well, so hot reload still works in
      // the proxied app rather than falling back to full page reloads.
      '/app': {
        target: 'http://localhost:5174',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
