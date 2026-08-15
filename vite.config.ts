import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import manifest from './src/manifest.ts'

const isFirefox = process.env.TARGET_BROWSER === 'firefox'

export default defineConfig(({ mode }) => {
  return {
    define: {
      // Prevents CRXJS client worker ReferenceError in service worker scope
      '__LIVE_RELOAD__': true,
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.TARGET_BROWSER': JSON.stringify(process.env.TARGET_BROWSER || 'chrome'),
    },
    server: {
      port: 5173,
      strictPort: true,
      ws: {
        port: 5173,
      },
    },
    build: {
      cssCodeSplit: true,
      emptyOutDir: true,
      outDir: isFirefox ? 'build-firefox' : 'build',
      rollupOptions: {
        input: {
          popup: 'src/popup/popup.html',
          dashboard: 'src/dashboard/dashboard.html',
        },
        output: {
          chunkFileNames: 'assets/chunk-[hash].js',
        },
      },
    },
    plugins: [crx({ manifest }), vue()],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})