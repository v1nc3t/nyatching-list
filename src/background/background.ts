// Safe polyfill for CRXJS HMR client worker in ServiceWorker scope
if (typeof self !== 'undefined' && typeof (self as any).__LIVE_RELOAD__ === 'undefined') {
  ;(self as any).__LIVE_RELOAD__ = true
}

import browser from 'webextension-polyfill'
import { getAllMedia, updateMedia, addNotificationLog, getSettings } from '../storage'
import { getTMDBDetails } from '../services/tmdb'
import { isShow, Show, TrackedMedia } from '../types'

// ==========================================
// CONSTANTS & TYPES
// ==========================================

const ALARM_NAME = 'nyatching_daily_check'

export interface SystemMessage {
  type?: 'SETTINGS_UPDATED' | 'TRIGGER_CHECK'
  action?: 'TRIGGER_CHECK' | 'UPDATE_SETTINGS'
}

// ==========================================
// ALARM MANAGEMENT
// ==========================================

export const setupAlarm = async (): Promise<void> => {
  await browser.alarms.clear(ALARM_NAME)
  const settings = await getSettings()

  const intervalHours = settings.newSeasonCheckIntervalHours ?? 24

  // -1 or <= 0 indicates "Never" / Disabled
  if (intervalHours <= 0) {
    console.log('[Nyatching Background] Episode checks disabled (Never).')
    return
  }

  const periodInMinutes = Math.max(1, intervalHours * 60)

  browser.alarms.create(ALARM_NAME, {
    delayInMinutes: periodInMinutes,
    periodInMinutes: periodInMinutes
  })

  console.log(`[Nyatching Background] Alarm scheduled for every ${intervalHours} hours.`)
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

      // Desktop Notification
      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: icon,
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} is available! Click to open dashboard.`,
        priority: 2
      })

      // Dashboard Log Entry
      await addNotificationLog({
        showId: show.id,
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} has been released!`,
        posterPath: show.posterPath
      })

      // Update Local State
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
  const settings = await getSettings()
  
  if (settings.newSeasonCheckIntervalHours <= 0) return

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
// NOTIFICATION LISTENERS
// ==========================================

browser.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('nyatching_show_')) {
    const dashboardUrl = browser.runtime.getURL('src/dashboard/dashboard.html')
    const tabs = await browser.tabs.query({ url: dashboardUrl })

    if (tabs.length > 0 && tabs[0].id) {
      await browser.tabs.update(tabs[0].id, { active: true })
    } else {
      await browser.tabs.create({ url: dashboardUrl })
    }

    await browser.notifications.clear(notificationId)
  }
})

// ==========================================
// SERVICE WORKER LIFECYCLE LISTENERS
// ==========================================

browser.runtime.onInstalled.addListener(async () => {
  await setupAlarm()
})

browser.runtime.onStartup.addListener(async () => {
  await setupAlarm()
})

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkWaitingShows()
  }
})

// Handles messages from Settings Modal or Popup UI
browser.runtime.onMessage.addListener(async (message: unknown) => {
  const msg = message as SystemMessage

  if (msg.type === 'SETTINGS_UPDATED' || msg.action === 'UPDATE_SETTINGS') {
    await setupAlarm()
    return { status: 'success' }
  }

  if (msg.action === 'TRIGGER_CHECK') {
    await checkWaitingShows()
    return { status: 'success' }
  }
})