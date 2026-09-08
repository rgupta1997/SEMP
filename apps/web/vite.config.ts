import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // THE APP IS NOT AT THE ROOT. The root of the site is the marketing page
  // (landing-page-v2); this app is served from /app. One deploy, two builds -
  // see netlify.toml and tools/assemble-site.mjs.
  //
  // This is the SINGLE SOURCE OF TRUTH for that prefix: `base` here sets
  // import.meta.env.BASE_URL, which App.tsx reads for the router's basename and
  // lib/brand.ts for its logo paths. Change it in one place and everything that
  // must agree with it follows.
  //
  // The dev server obeys it too - `npm run dev:web` serves on
  // http://localhost:5173/app/ - deliberately, so a path bug that only appears
  // under a prefix appears in development rather than first in production.
  base: '/app/',
  // 5174, BEHIND the marketing site's dev server on 5173, which proxies /app here
  // (see landing-page-v2/vite.config.js). Open http://localhost:5173/app - one
  // origin in development, laid out exactly like the deploy. Hitting 5174/app
  // directly also works if you only want the product.
  server: { port: 5174, strictPort: true },
});
