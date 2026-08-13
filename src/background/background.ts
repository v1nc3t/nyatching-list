// Safe polyfill for CRXJS HMR client worker in ServiceWorker scope
if (typeof self !== 'undefined' && typeof (self as any).__LIVE_RELOAD__ === 'undefined') {
  ;(self as any).__LIVE_RELOAD__ = true
}

import { getAllMedia, updateMedia, addNotificationLog } from '../storage'
import { getTMDBDetails } from '../services/tmdb'
import { isShow, Show, TrackedMedia } from '../types'

// ==========================================
// CONSTANTS & TYPES
// ==========================================

const ALARM_NAME = 'nyatching_daily_check'

export interface NotificationSettings {
  enabled: boolean
  intervalMinutes: number // Default 1440 (24h)
}

export interface SystemMessage {
  action: 'TRIGGER_CHECK' | 'UPDATE_SETTINGS'
  payload?: Partial<NotificationSettings>
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  intervalMinutes: 1440
}

// ==========================================
// SETTINGS & ALARM MANAGEMENT
// ==========================================

export const getNotificationSettings = async (): Promise<NotificationSettings> => {
  try {
    const result = await chrome.storage.local.get('notification_settings')
    return result.notification_settings || DEFAULT_SETTINGS
  } catch (error) {
    console.error('[Nyatching Storage] Failed to load settings:', error)
    return DEFAULT_SETTINGS
  }
}

export const saveNotificationSettings = async (settings: NotificationSettings): Promise<void> => {
  await chrome.storage.local.set({ notification_settings: settings })
  await setupAlarm()
}

export const setupAlarm = async (): Promise<void> => {
  await chrome.alarms.clear(ALARM_NAME)
  const settings = await getNotificationSettings()

  if (settings.enabled) {
    const period = Math.max(1, settings.intervalMinutes)
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: period,
      periodInMinutes: period
    })
  }
}

// ==========================================
// UTILITY HELPERS
// ==========================================

const isTrackedShow = (media: TrackedMedia): media is Show => {
  if (!isShow(media)) return false
  if (!media.tmdbId) return false

  if (typeof media.tracked === 'boolean') {
    return media.tracked
  }

  return media.status === 'waiting'
}

// ==========================================
// POLLING LOGIC
// ==========================================

const processShowUpdate = async (show: Show): Promise<boolean> => {
  if (!show.tmdbId) return false

  try {
    const tmdbData = await getTMDBDetails(show.tmdbId, 'show')
    const latestSeasons: number | undefined = tmdbData?.number_of_seasons

    if (typeof latestSeasons !== 'number' || latestSeasons <= 0) {
      return false
    }

    const lastKnown: number = show.totalSeasons || 0

    if (latestSeasons > lastKnown) {
      const icon = show.posterPath && show.posterPath.startsWith('http')
        ? show.posterPath
        : 'img/logo-128.png'

      const notificationId = `nyatching_show_${show.id}_${latestSeasons}_${Date.now()}`

      // Dispatch desktop notification (no buttons)
      chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: icon,
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} is available! Click to open dashboard.`,
        priority: 2
      })

      // Persist entry into dashboard notification log
      await addNotificationLog({
        showId: show.id,
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} has been released!`,
        posterPath: show.posterPath
      })

      // Update season count in local media storage
      await updateMedia({
        id: show.id,
        totalSeasons: latestSeasons,
        status: 'waiting'
      })

      return true
    }
  } catch (err) {
    console.error(`[Nyatching Background] Error processing show "${show.title}":`, err)
  }

  return false
}

export const checkWaitingShows = async (): Promise<void> => {
  const settings = await getNotificationSettings()
  if (!settings.enabled) return

  try {
    const allMedia: TrackedMedia[] = await getAllMedia()
    const trackedShows = allMedia.filter(isTrackedShow)

    if (trackedShows.length === 0) return

    for (const show of trackedShows) {
      await processShowUpdate(show)
    }
  } catch (error) {
    console.error('[Nyatching Background] Critical error during show polling:', error)
  }
}

if (typeof self !== 'undefined') {
  ;(self as any).checkWaitingShows = checkWaitingShows
}

// ==========================================
// NOTIFICATION ACTION LISTENERS
// ==========================================

/**
 * Handles clicks anywhere on the notification body.
 */
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('nyatching_show_')) {
    const dashboardUrl = chrome.runtime.getURL('src/dashboard/dashboard.html')
    const tabs = await chrome.tabs.query({ url: dashboardUrl })

    if (tabs.length > 0 && tabs[0].id) {
      await chrome.tabs.update(tabs[0].id, { active: true })
    } else {
      await chrome.tabs.create({ url: dashboardUrl })
    }

    chrome.notifications.clear(notificationId)
  }
})

// ==========================================
// SERVICE WORKER LIFECYCLE LISTENERS
// ==========================================

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarm()
})

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarm()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkWaitingShows()
  }
})

chrome.runtime.onMessage.addListener((message: SystemMessage, _sender, sendResponse) => {
  if (message.action === 'TRIGGER_CHECK') {
    checkWaitingShows()
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: String(err) }))
    return true
  }

  if (message.action === 'UPDATE_SETTINGS' && message.payload) {
    getNotificationSettings()
      .then((current) => saveNotificationSettings({ ...current, ...message.payload }))
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: String(err) }))
    return true
  }
})