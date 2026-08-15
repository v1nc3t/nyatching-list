import { ref } from 'vue'
import browser from 'webextension-polyfill'

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

  // 1. Get initial theme from extension storage (with system preference fallback)
  const initTheme = async () => {
    try {
      const data = await browser.storage.local.get(THEME_STORAGE_KEY)
      if (data[THEME_STORAGE_KEY]) {
        theme.value = data[THEME_STORAGE_KEY] as Theme
        applyThemeToDocument(theme.value)
        return
      }
    } catch {
      // Storage unavailable (e.g. plain browser preview) — fall through
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

  // 2. Reactively listen to storage changes from OTHER pages/tabs
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[THEME_STORAGE_KEY]) {
      const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme
      if (newTheme && newTheme !== theme.value) {
        theme.value = newTheme
        applyThemeToDocument(newTheme)
      }
    }
  })

  // 3. Save theme changes to extension storage when toggled
  const toggleTheme = async () => {
    const nextTheme: Theme = theme.value === 'dark' ? 'light' : 'dark'
    theme.value = nextTheme
    applyThemeToDocument(nextTheme)

    try {
      await browser.storage.local.set({ [THEME_STORAGE_KEY]: nextTheme })
    } catch (error) {
      console.error('[Nyatching List] Failed to persist theme:', error)
    }
  }

  return {
    theme,
    toggleTheme,
  }
}