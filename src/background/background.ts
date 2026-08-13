import { getAllMedia, updateMedia } from '../storage'
import { getTMDBDetails } from '../services/tmdb'
import { isShow } from '../types'

const ALARM_NAME = 'nyatching_daily_check'

// ==========================================
// TYPES & SETTINGS MANAGERS
// ==========================================

export interface NotificationSettings {
  enabled: boolean
  intervalMinutes: number // Default 1440 (24 hours), Max 43200 (30 days)
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  intervalMinutes: 1440
}

/**
 * Retrieves notification settings from local storage.
 */
export const getNotificationSettings = async (): Promise<NotificationSettings> => {
  const result = await chrome.storage.local.get('notification_settings')
  return result.notification_settings || DEFAULT_SETTINGS
}

/**
 * Saves notification settings and reconfigures the background alarm.
 */
export const saveNotificationSettings = async (settings: NotificationSettings): Promise<void> => {
  await chrome.storage.local.set({ notification_settings: settings })
  await setupAlarm()
}

/**
 * Configures or removes the Chrome Alarm depending on active settings.
 * Ensures initial run triggers seamlessly without waiting for the full initial period delay.
 */
export const setupAlarm = async (): Promise<void> => {
  await chrome.alarms.clear(ALARM_NAME)
  const settings = await getNotificationSettings()

  if (settings.enabled) {
    // Sanity check: Ensure interval is a positive number
    const period = Math.max(1, settings.intervalMinutes)

    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: period, // First trigger occurs after designated period
      periodInMinutes: period
    })
  }
}

// ==========================================
// POLLING LOGIC
// ==========================================

/**
 * Checks all shows with 'waiting' status against TMDB for new season releases.
 */
export const checkWaitingShows = async (): Promise<void> => {
  const settings = await getNotificationSettings()
  if (!settings.enabled) return

  const allMedia = await getAllMedia()

  // Type-narrow array to Show[] and filter for waiting status
  const waitingShows = allMedia
    .filter(isShow)
    .filter((show) => show.status === 'waiting' && show.tmdbId)

  for (const show of waitingShows) {
    if (!show.tmdbId) continue

    try {
      const tmdbData = await getTMDBDetails(show.tmdbId, 'show')
      if (!tmdbData || !tmdbData.number_of_seasons) continue

      const latestSeasons: number = tmdbData.number_of_seasons
      const lastKnown: number = show.totalSeasons || 0

      if (latestSeasons > lastKnown) {
        // Trigger Chrome Desktop Notification
        chrome.notifications.create(`new_season_${show.id}_${latestSeasons}`, {
          type: 'basic',
          iconUrl: show.posterPath || '/assets/icon128.png',
          title: 'New Season Available!',
          message: `Season ${latestSeasons} of "${show.title}" has been released!`,
          priority: 2
        })

        // Update stored last_known totalSeasons using the single-object UpdateMediaInput
        await updateMedia({
          id: show.id,
          totalSeasons: latestSeasons
        })
      }
    } catch (err) {
      console.error(`[Nyatching Background] Failed to poll TMDB for "${show.title}":`, err)
    }
  }
}

// ==========================================
// SERVICE WORKER LISTENERS
// ==========================================

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm()
})

chrome.runtime.onStartup.addListener(() => {
  setupAlarm()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkWaitingShows()
  }
})