import { defineConfig, Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import manifest from './src/manifest.ts'

const isFirefox = process.env.TARGET_BROWSER === 'firefox'

const cleanFirefoxManifest = (): Plugin => {
  return {
    name: 'clean-firefox-manifest',
    enforce: 'post',
    generateBundle(_, bundle) {
      const manifestFile = bundle['manifest.json']
      if (manifestFile && manifestFile.type === 'asset' && typeof manifestFile.source === 'string') {
        const parsed = JSON.parse(manifestFile.source)

        if (Array.isArray(parsed.web_accessible_resources)) {
          parsed.web_accessible_resources = parsed.web_accessible_resources.map(
            (entry: Record<string, any>) => {
              const { use_dynamic_url, ...rest } = entry
              return rest
            }
          )
        }

        manifestFile.source = JSON.stringify(parsed, null, 2)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  return {
    define: {
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
    plugins: [
      crx({ manifest }),
      vue(),
      ...(isFirefox ? [cleanFirefoxManifest()] : []),
    ],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})