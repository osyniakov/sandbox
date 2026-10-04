import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: false,
  },
  plugins: [
    react(),
    // Tailwind CSS v4 (current as of 2026-08): config-file-based setup was
    // replaced in v4 by this official Vite plugin + CSS-first configuration
    // (see src/index.css `@import "tailwindcss"`). No tailwind.config.js or
    // postcss.config.js is needed for this setup. Chosen because it's the
    // officially recommended install path per Tailwind's current docs, not
    // an assumption carried over from v3-era tooling.
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Basement Declutter',
        short_name: 'Declutter',
        description:
          'Photograph an item, find comparable listings, and get a sell / give-away / throw-away recommendation.',
        start_url: '/',
        display: 'standalone',
        // Kept in sync with the light-mode design tokens in src/index.css
        // (sandbox-2pc.1) so the installed-PWA chrome matches the app:
        //   background_color -> --ground  (#f7f6f9)
        //   theme_color       -> --primary (#8b2ff0)
        // If those tokens ever change, update these two values to match.
        background_color: '#f7f6f9',
        theme_color: '#8b2ff0',
        icons: [
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
