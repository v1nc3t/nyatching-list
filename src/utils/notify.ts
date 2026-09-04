import browser from 'webextension-polyfill'

export const EXTENSION_ICON_URL = (): string => {
  try {
    return browser.runtime.getURL('img/logo-48.png')
  } catch {
    return 'img/logo-48.png'
  }
}

const isFirefox = (): boolean =>
  typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

const isUiPage = (): boolean => {
  try {
    return /popup|dashboard/i.test(globalThis.location?.pathname ?? '')
  } catch {
    return false
  }
}

const getChromeNotifications = (): typeof chrome.notifications | undefined => {
  return (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.notifications
}

// Firefox drops every toast if create() is called twice in rapid succession:
// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/notifications/create
const FIREFOX_CREATE_GAP_MS = 2000

let firefoxNotifyChain: Promise<void> = Promise.resolve()

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const enqueueFirefoxCreate = (task: () => Promise<boolean>): Promise<boolean> => {
  const result = firefoxNotifyChain.then(task, task)
  firefoxNotifyChain = result.then(() => wait(FIREFOX_CREATE_GAP_MS)).then(() => undefined)
  return result
}

type NotificationPayload = {
  type: 'basic'
  iconUrl: string
  title: string
  message: string
}

const mdnNotificationOptions = (title: string, message: string): NotificationPayload => ({
  type: 'basic',
  iconUrl: EXTENSION_ICON_URL(),
  title,
  message,
})

const createWithWebExtensionApi = async (
  id: string,
  payload: NotificationPayload
): Promise<boolean> => {
  try {
    const createdId = await browser.notifications.create(id, payload)
    console.log('[Nyatching List] OS notification created', createdId)
    return true
  } catch (error) {
    console.error('[Nyatching List] browser.notifications.create failed:', error)
    return false
  }
}

const createChromeNotification = async (options: {
  id: string
  title: string
  message: string
}): Promise<boolean> => {
  const payload = mdnNotificationOptions(options.title, options.message)
  if (await createWithWebExtensionApi(options.id, payload)) return true

  const chromeNotifications = getChromeNotifications()
  if (!chromeNotifications?.create) return false

  try {
    await new Promise<void>((resolve, reject) => {
      chromeNotifications.create(options.id, payload, () => {
        const lastError = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome
          ?.runtime?.lastError
        if (lastError) {
          reject(new Error(lastError.message))
          return
        }
        resolve()
      })
    })
    return true
  } catch (error) {
    console.error('[Nyatching List] chrome.notifications.create failed:', error)
    return false
  }
}

export const createOsNotificationLocal = async (options: {
  id: string
  title: string
  message: string
  iconUrl?: string
}): Promise<boolean> => {
  if (isFirefox()) {
    return enqueueFirefoxCreate(() =>
      createWithWebExtensionApi(options.id, mdnNotificationOptions(options.title, options.message))
    )
  }

  return createChromeNotification(options)
}

export async function createOsNotification(options: {
  id: string
  title: string
  message: string
  iconUrl?: string
}): Promise<boolean> {
  if (isUiPage()) {
    try {
      const result = (await browser.runtime.sendMessage({
        type: 'SHOW_OS_NOTIFICATION',
        payload: {
          id: options.id,
          title: options.title,
          message: options.message,
        },
      })) as { status?: string } | undefined
      if (result?.status === 'shown') return true
    } catch (error) {
      console.error('[Nyatching List] Could not reach background for OS notification:', error)
    }
  }

  return createOsNotificationLocal(options)
}
