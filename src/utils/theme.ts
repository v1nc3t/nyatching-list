import { ref, watch } from 'vue'

export type Theme = 'light' | 'dark'
const THEME_STORAGE_KEY = 'nyatching_theme'

/**
 * Applies CSS theme classes to the document element (<html>).
 */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('theme-dark', theme === 'dark')
  document.documentElement.classList.toggle('theme-light', theme === 'light')
}

/**
 * Vue composable for reactive, cross-context theme management.
 */
export function useTheme() {
  const theme = ref<Theme>('dark')

  // 1. Get initial theme from chrome.storage.local (with system preference fallback)
  const initTheme = async () => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get(THEME_STORAGE_KEY)
      if (data[THEME_STORAGE_KEY]) {
        theme.value = data[THEME_STORAGE_KEY] as Theme
        applyThemeToDocument(theme.value)
        return
      }
    }

    // Fallback: check system color scheme preference
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
      theme.value = 'light'
    } else {
      theme.value = 'dark'
    }
    applyThemeToDocument(theme.value)
  }

  initTheme()

  // 2. Reactively listen to chrome.storage changes from OTHER pages/tabs
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[THEME_STORAGE_KEY]) {
        const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme
        if (newTheme && newTheme !== theme.value) {
          theme.value = newTheme
          applyThemeToDocument(newTheme)
        }
      }
    })
  }

  // 3. Save theme changes to chrome.storage.local when toggled
  const toggleTheme = async () => {
    const nextTheme: Theme = theme.value === 'dark' ? 'light' : 'dark'
    theme.value = nextTheme
    applyThemeToDocument(nextTheme)

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme })
    }
  }

  return {
    theme,
    toggleTheme,
  }
}