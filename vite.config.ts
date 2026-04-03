import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  optimizeDeps: {
    // yFiles MUST be excluded from Vite's esbuild pre-bundler.
    // It uses instanceof checks across module boundaries and internal
    // singleton registries that break when transformed by esbuild.
    exclude: ['yfiles']
  },
  build: {
    // yFiles requires ES2017+ target
    target: 'esnext',
    sourcemap: true,
    // yFiles is legitimately large; suppress noisy chunk size warnings
    chunkSizeWarningLimit: 4000
  }
})
