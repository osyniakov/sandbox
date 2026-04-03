import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  optimizeDeps: {
    // Pre-bundle yFiles to avoid cold-start issues with large ES module
    include: ['yfiles']
  },
  build: {
    // yFiles requires ES2017+ target
    target: 'esnext',
    sourcemap: true
  }
})
