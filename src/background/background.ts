// Safe polyfill for CRXJS HMR client worker in ServiceWorker scope
if (typeof self !== 'undefined' && typeof (self as any).__LIVE_RELOAD__ === 'undefined') {
  ;(self as any).__LIVE_RELOAD__ = true
}

import browser from 'webextension-polyfill'
import { getMediaById, getSettings, onMediaStorageChange } from '../storage'
import { createOsNotificationLocal } from '../utils/notify'
import { checkShowReleases, checkStallReminders, parseReleaseNotificationShowId } from './release-poll'
import {
  ALARM_NAME,
  STALL_ALARM_NAME,
  isMissedScheduledCheck,
  isMissedStallCheck,
  scheduleAllAlarms,
  scheduleReleaseCheckAlarm,
  scheduleStallAlarm,
} from './alarm-schedule'

export interface SystemMessage {
  type?: 'SETTINGS_UPDATED' | 'SHOW_OS_NOTIFICATION'
  action?: 'UPDATE_SETTINGS'
  payload?: {
    id: string
    title: string
    message: string
  }
}

export const setupAlarm = async (options: { skipCatchUp?: boolean } = {}): Promise<void> => {
  const settings = await getSettings()

  if (!options.skipCatchUp) {
    if (isMissedScheduledCheck(settings)) {
      console.log('[Nyatching Background] Missed episode check; running now.')
      await checkShowReleases()
    }
    if (await isMissedStallCheck(settings)) {
      console.log('[Nyatching Background] Missed inactivity reminder; running now.')
      await checkStallReminders()
    }
  }

  await scheduleAllAlarms(await getSettings())
}

if (typeof self !== 'undefined') {
  ;(self as any).checkShowReleases = checkShowReleases
  ;(self as any).checkStallReminders = checkStallReminders
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

browser.notifications.onClicked.addListener(async (notificationId) => {
  const releaseShowId = parseReleaseNotificationShowId(notificationId)
  const isLegacyRelease =
    notificationId.startsWith('nyatching_show_') ||
    notificationId.startsWith('nyatching_episode_')

  if (releaseShowId || isLegacyRelease) {
    if (releaseShowId) {
      await openWatchingLinkOrDashboard(releaseShowId)
    } else {
      await openDashboard()
    }
    await browser.notifications.clear(notificationId)
  }
})

browser.runtime.onInstalled.addListener(async () => {
  await setupAlarm()
})

browser.runtime.onStartup.addListener(async () => {
  await setupAlarm()
})

const handleAlarm = async (alarm: { name: string }): Promise<void> => {
  try {
    if (alarm.name === ALARM_NAME) {
      await checkShowReleases()
      await scheduleReleaseCheckAlarm()
      return
    }
    if (alarm.name === STALL_ALARM_NAME) {
      await checkStallReminders()
      await scheduleStallAlarm()
    }
  } catch (error) {
    console.error('[Nyatching Background] Scheduled check failed:', error)
  }
}

browser.alarms.onAlarm.addListener((alarm) => handleAlarm(alarm))

onMediaStorageChange(() => {
  void scheduleStallAlarm()
})

self.addEventListener('notificationclick', (event) => {
  const notificationEvent = event as Event & {
    notification: { tag?: string; data?: { notificationId?: string }; close: () => void }
    waitUntil: (promise: Promise<unknown>) => void
  }
  notificationEvent.notification.close()
  const notificationId =
    notificationEvent.notification.data?.notificationId || notificationEvent.notification.tag || ''
  const releaseShowId = parseReleaseNotificationShowId(notificationId)
  notificationEvent.waitUntil(openWatchingLinkOrDashboard(releaseShowId))
})

const handleRuntimeMessage = async (message: unknown): Promise<{ status: string }> => {
  const msg = message as SystemMessage

  if (msg.type === 'SETTINGS_UPDATED' || msg.action === 'UPDATE_SETTINGS') {
    await setupAlarm()
    return { status: 'success' }
  }

  if (msg.type === 'SHOW_OS_NOTIFICATION' && msg.payload) {
    const ok = await createOsNotificationLocal(msg.payload)
    return { status: ok ? 'shown' : 'failed' }
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
