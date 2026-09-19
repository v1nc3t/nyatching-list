// Safe polyfill for CRXJS HMR client worker in ServiceWorker scope
if (typeof self !== 'undefined' && typeof (self as any).__LIVE_RELOAD__ === 'undefined') {
  ;(self as any).__LIVE_RELOAD__ = true
}

import browser from 'webextension-polyfill'
import { getMediaById, getSettings } from '../storage'
import { checkShowReleases, parseReleaseNotificationShowId } from './release-poll'
import { ALARM_NAME, isMissedScheduledCheck, scheduleReleaseCheckAlarm } from './alarm-schedule'

const setupAlarm = async (): Promise<void> => {
  try {
    const settings = await getSettings()
    if (isMissedScheduledCheck(settings)) {
      console.log('[Nyatching Background] Missed episode check; running now.')
      await checkShowReleases()
    }
  } catch (error) {
    console.error('[Nyatching Background] Catch-up check failed:', error)
  } finally {
    await scheduleReleaseCheckAlarm()
  }
}

const openDashboard = async (): Promise<void> => {
  try {
    await browser.runtime.openOptionsPage()
  } catch {
    await browser.tabs.create({
      url: browser.runtime.getURL('src/dashboard/dashboard.html'),
    })
  }
}

const openWatchingLinkOrDashboard = async (showId: string | null): Promise<void> => {
  if (showId) {
    const media = await getMediaById(showId)
    const url = media?.watchingUrl?.trim()
    if (url && /^https?:\/\//i.test(url)) {
      await browser.tabs.create({ url })
      return
    }
  }
  await openDashboard()
}

if (browser.notifications?.onClicked) {
  browser.notifications.onClicked.addListener(async (notificationId) => {
    const mediaId = parseReleaseNotificationShowId(notificationId)
    const isLegacy =
      notificationId.startsWith('nyatching_show_') || notificationId.startsWith('nyatching_episode_')
    if (!mediaId && !isLegacy) return
    await openWatchingLinkOrDashboard(mediaId)
    await browser.notifications.clear(notificationId)
  })
}

browser.runtime.onInstalled.addListener(() => setupAlarm())
browser.runtime.onStartup.addListener(() => setupAlarm())

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return
  try {
    await checkShowReleases()
  } catch (error) {
    console.error('[Nyatching Background] Scheduled check failed:', error)
  } finally {
    try {
      await scheduleReleaseCheckAlarm()
    } catch (error) {
      console.error('[Nyatching Background] Failed to reschedule:', error)
    }
  }
})

const handleRuntimeMessage = async (message: unknown): Promise<{ status: string }> => {
  const type = (message as { type?: string }).type
  if (type === 'SETTINGS_UPDATED') {
    await setupAlarm()
    return { status: 'success' }
  }
  return { status: 'ignored' }
}

const chromeRuntime = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.runtime
const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent)

if (!isFirefox && chromeRuntime?.onMessage) {
  chromeRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    handleRuntimeMessage(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.error('[Nyatching Background] Message handler failed:', error)
        sendResponse({ status: 'error' })
      })
    return true
  })
} else {
  browser.runtime.onMessage.addListener((message: unknown) => handleRuntimeMessage(message))
}
