import { defineManifest } from '@crxjs/vite-plugin'
import packageData from '../package.json' with { type: 'json' }

const isFirefox = process.env.TARGET_BROWSER === 'firefox'

export default defineManifest({
  name: packageData.name,
  description: packageData.description,
  version: packageData.version,
  manifest_version: 3,
  icons: {
    16: 'img/logo-16.png',
    32: 'img/logo-32.png',
    48: 'img/logo-48.png',
    128: 'img/logo-128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: 'img/logo-48.png',
  },
  // Firefox MV3 requires background.scripts instead of background.service_worker
  background: isFirefox
    ? {
        scripts: ['src/background/background.ts'],
        type: 'module',
      }
    : {
        service_worker: 'src/background/background.ts',
        type: 'module',
      },
  web_accessible_resources: [
    {
      resources: ['img/logo-16.png', 'img/logo-32.png', 'img/logo-48.png', 'img/logo-128.png'],
      matches: ['https://www.imdb.com/*'],
    },
  ],
  // options_ui works across Chrome + Firefox; options_page alone needs Firefox 126+
  options_ui: {
    page: 'src/dashboard/dashboard.html',
    open_in_tab: true,
  },
  permissions: ['storage', 'alarms', 'notifications'],
  host_permissions: [
    'https://api.themoviedb.org/3/*',
    'https://www.imdb.com/*',
  ],
  // Firefox MV3 requirements for webextension IDs during development/submission
  ...(isFirefox && {
    browser_specific_settings: {
      gecko: {
        id: 'nyatching-list@example.com', // Replace with your actual extension ID or email-style ID
        // 112+ required for background.type: "module"
        strict_min_version: '112.0',
      },
    },
  }),
})