/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The production address (siteConfig.origin in src/site-config.ts).
const origin = 'https://lyra.eiselabs.com';

// The app's version, from the workspace Cargo.toml, for the home page's
// structured data. Pre-releases are not what the download buttons offer, so
// they are left out.
const cargo = readFileSync(new URL('../../Cargo.toml', import.meta.url), 'utf8');
const version = /\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
if (!version) throw new Error('vite.config: no [workspace.package] version in Cargo.toml');

export default defineConfig({
  define: {
    __LYRA_STABLE_VERSION__: JSON.stringify(version.includes('-') ? '' : version),
  },
  plugins: [
    // TanStack Start renders every page on the server. The build prerenders
    // each static route to <path>/index.html and writes sitemap.xml, so pages
    // ship their headings, copy and meta tags in the HTML itself.
    tanstackStart({
      router: { quoteStyle: 'single', semicolons: true },
      // Every static route is found from the route tree; following links would
      // also pick up in-page anchors such as /#faq.
      prerender: { enabled: true, crawlLinks: false, failOnError: true },
      // The SPA shell (_shell.html) answers unknown addresses: the worker
      // serves it with a 404 status and the not-found page renders in the
      // browser. The shell takes the place of the page at its mask path, so
      // the default, `/`, would leave the home page unrendered. /_shell is no
      // page: the catch-all route (routes/$.tsx) answers it, and nobody visits
      // it (at the mask path itself the browser re-renders the page area).
      spa: { enabled: true, maskPath: '/_shell' },
      sitemap: { enabled: true, host: origin },
    }),
    // React's plugin must come after Start's.
    react(),
  ],
  environments: {
    client: {
      build: {
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
    },
  },
  server: {
    host: '0.0.0.0',
    // Cloudflare quick tunnels get a random subdomain each run; the leading
    // dot allows any of them.
    allowedHosts: ['terminal.local', '.trycloudflare.com'],
  },
  test: {
    // tests/ holds the Sites worker checks, which run under node:test.
    include: ['src/**/*.test.ts'],
  },
});
