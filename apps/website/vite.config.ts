/// <reference types="vitest/config" />
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // The router plugin generates src/routeTree.gen.ts and splits each route's
    // component into its own chunk. It must run before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, quoteStyle: 'single', semicolons: true }),
    react(),
  ],
  build: {
    outDir: 'dist/client',
    rolldownOptions: {
      output: {
        // Libraries change less often than the site, so they get their own
        // chunks: cached across deploys and loaded in parallel with the app.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/ },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'motion/react', '@tanstack/react-router', '@phosphor-icons/react'],
  },
  server: {
    host: '0.0.0.0',
    // Cloudflare quick tunnels get a random subdomain each run; the leading
    // dot allows any of them.
    allowedHosts: ['terminal.local', '.trycloudflare.com'],
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
  test: {
    // tests/ holds the Sites worker checks, which run under node:test.
    include: ['src/**/*.test.ts'],
  },
});
