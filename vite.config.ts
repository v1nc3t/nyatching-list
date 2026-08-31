import { defineConfig, Plugin } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import vue from '@vitejs/plugin-vue'
import manifest from './src/manifest.ts'

const isFirefox = process.env.TARGET_BROWSER === 'firefox'

const patchFirefoxManifest = (parsed: Record<string, any>) => {
  // Firefox temporary/permanent installs reject background.service_worker.
  // CRXJS may rewrite scripts → service_worker; force scripts back.
  if (parsed.background?.service_worker) {
    parsed.background = {
      scripts: [parsed.background.service_worker],
      ...(parsed.background.type ? { type: parsed.background.type } : {}),
    }
  }

  if (Array.isArray(parsed.web_accessible_resources)) {
    parsed.web_accessible_resources = parsed.web_accessible_resources
      .filter((entry: Record<string, any>) => {
        const matches = entry.matches ?? []
        // Drop the CRXJS catch-all WAR entry; keep only intentional ones
        return !(matches.length === 1 && matches[0] === '<all_urls>')
      })
      .map((entry: Record<string, any>) => {
        const { use_dynamic_url, ...rest } = entry
        return rest
      })
  }

  return parsed
}

const cleanFirefoxManifest = (): Plugin => {
  return {
    name: 'clean-firefox-manifest',
    enforce: 'post',
    generateBundle(_, bundle) {
      const manifestFile = bundle['manifest.json']
      if (manifestFile && manifestFile.type === 'asset' && typeof manifestFile.source === 'string') {
        const parsed = patchFirefoxManifest(JSON.parse(manifestFile.source))
        manifestFile.source = JSON.stringify(parsed, null, 2)
      }
    },
    async writeBundle(options) {
      // Safety net: patch the written file if CRXJS rewrote it after generateBundle
      const { readFile, writeFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const outDir = options.dir
      if (!outDir) return

      const manifestPath = join(outDir, 'manifest.json')
      try {
        const raw = await readFile(manifestPath, 'utf8')
        const parsed = patchFirefoxManifest(JSON.parse(raw))
        await writeFile(manifestPath, JSON.stringify(parsed, null, 2))
      } catch {
        // ignore missing manifest during partial builds
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
      crx({
        manifest,
        // Required so CRXJS emits background.scripts (Firefox rejects service_worker)
        browser: isFirefox ? 'firefox' : 'chrome',
      }),
      vue(),
      ...(isFirefox ? [cleanFirefoxManifest()] : []),
    ],
    legacy: {
      skipWebSocketTokenCheck: true,
    },
  }
})