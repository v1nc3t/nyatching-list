import browser from 'webextension-polyfill'

export const EXTENSION_ICON_URL = (): string => browser.runtime.getURL('img/logo-128.png')

const getChromeNotifications = (): typeof chrome.notifications | undefined => {
  return (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.notifications
}

export async function createOsNotification(options: {
  id: string
  title: string
  message: string
  iconUrl?: string
}): Promise<boolean> {
  const fallbackIcon = EXTENSION_ICON_URL()
  const iconUrl =
    options.iconUrl && !options.iconUrl.startsWith('http') ? options.iconUrl : fallbackIcon

  const payload = {
    type: 'basic' as const,
    iconUrl,
    title: options.title,
    message: options.message,
  }

  const chromeNotifications = getChromeNotifications()
  if (chromeNotifications?.create) {
    return await new Promise((resolve) => {
      chromeNotifications.create(options.id, payload, () => {
        const lastError = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome
          ?.runtime?.lastError
        if (lastError) {
          console.error('[Nyatching List] OS notification failed:', lastError.message)
          resolve(false)
          return
        }
        resolve(true)
      })
    })
  }

  try {
    await browser.notifications.create(options.id, payload)
    return true
  } catch (error) {
    console.error('[Nyatching List] OS notification failed:', error)
    return false
  }
}
