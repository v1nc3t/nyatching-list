import { ref, nextTick } from 'vue'
import browser from 'webextension-polyfill'
import { THEME_STORAGE_KEY } from '../storage'

export type Theme = 'light' | 'dark'

/**
 * Applies CSS theme classes to the document element (<html>).
 */
export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('theme-dark', theme === 'dark')
  document.documentElement.classList.toggle('theme-light', theme === 'light')
}

/**
 * Runs the theme swap as a circle that grows from the toggle button to cover the page.
 * Browsers without view transitions, and reduced motion, swap at once.
 * Resolves once the swap has run.
 */
function revealTheme(origin: Element | null, swap: () => void): Promise<void> {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!origin || reduceMotion || !document.startViewTransition) {
    swap()
    return Promise.resolve()
  }

  const box = origin.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  // Distance to the farthest corner, so the circle ends covering the whole page
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))

  const transition = document.startViewTransition(async () => {
    swap()
    await nextTick()
  })
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 500, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
      )
    })
    .catch(() => {
      // Skipped transition: the theme is already swapped
    })
  return transition.updateCallbackDone
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
  try {
    browser.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[THEME_STORAGE_KEY]) {
        const newTheme = changes[THEME_STORAGE_KEY].newValue as Theme
        if (newTheme && newTheme !== theme.value) {
          theme.value = newTheme
          applyThemeToDocument(newTheme)
        }
      }
    })
  } catch {
    // Storage events are unavailable outside the extension.
  }

  // 3. Save theme changes to extension storage when toggled
  const toggleTheme = async (event?: MouseEvent) => {
    const nextTheme: Theme = theme.value === 'dark' ? 'light' : 'dark'
    // Save only after the swap: the storage listener above would otherwise apply the
    // theme outside the animation, and the page flashes the new color first
    await revealTheme((event?.currentTarget as Element | null) ?? null, () => {
      theme.value = nextTheme
      applyThemeToDocument(nextTheme)
    })

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