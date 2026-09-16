import browser from 'webextension-polyfill'

const iconUrl = (): string => {
  try {
    return browser.runtime.getURL('img/logo-48.png')
  } catch {
    return 'img/logo-48.png'
  }
}

const isFirefox = (): boolean =>
  typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

const FIREFOX_CREATE_GAP_MS = 2000
let firefoxNotifyChain: Promise<void> = Promise.resolve()
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const optionsFor = (title: string, message: string) => ({
  type: 'basic' as const,
  iconUrl: iconUrl(),
  title,
  message,
})

const create = async (id: string, title: string, message: string): Promise<boolean> => {
  const options = optionsFor(title, message)
  try {
    await browser.notifications.create(id, options)
    return true
  } catch (error) {
    console.error('[Nyatching List] browser.notifications.create failed:', error)
  }

  const chromeNotifications = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome
    ?.notifications
  if (!chromeNotifications?.create) return false

  try {
    await new Promise<void>((resolve, reject) => {
      chromeNotifications.create(id, options, () => {
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

export async function createOsNotification(options: {
  id: string
  title: string
  message: string
}): Promise<boolean> {
  const run = () => create(options.id, options.title, options.message)
  if (!isFirefox()) return run()

  const result = firefoxNotifyChain.then(run, run)
  firefoxNotifyChain = result.then(() => wait(FIREFOX_CREATE_GAP_MS)).then(() => undefined)
  return result
}
