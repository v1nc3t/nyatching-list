// Safe polyfill for CRXJS HMR client worker in ServiceWorker scope
if (typeof self !== 'undefined' && typeof (self as any).__LIVE_RELOAD__ === 'undefined') {
  ;(self as any).__LIVE_RELOAD__ = true
}

import browser from 'webextension-polyfill'
import { getAllMedia, updateMedia, addNotificationLog, getSettings } from '../storage'
import { getTMDBDetails } from '../services/tmdb'
import { isShow, MediaStatus, Show, TrackedMedia } from '../types'

// ==========================================
// CONSTANTS & TYPES
// ==========================================

const ALARM_NAME = 'nyatching_daily_check'
const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface SystemMessage {
  type?: 'SETTINGS_UPDATED' | 'TRIGGER_CHECK'
  action?: 'TRIGGER_CHECK' | 'UPDATE_SETTINGS'
}

// ==========================================
// ALARM MANAGEMENT
// ==========================================

const isTrackableStatus = (status: MediaStatus) => status === 'watching' || status === 'waiting'

/** Pick how often the alarm should fire based on enabled check intervals. */
const resolveAlarmPeriodMinutes = (
  seasonIntervalHours: number,
  stallReminderDays: number
): number | null => {
  const candidates: number[] = []

  if (seasonIntervalHours > 0) {
    candidates.push(seasonIntervalHours * 60)
  }

  // Stall threshold is in days; poll at least daily while reminders are on
  if (stallReminderDays > 0) {
    candidates.push(24 * 60)
  }

  if (candidates.length === 0) return null
  return Math.max(1, Math.min(...candidates))
}

export const setupAlarm = async (): Promise<void> => {
  await browser.alarms.clear(ALARM_NAME)
  const settings = await getSettings()

  const periodInMinutes = resolveAlarmPeriodMinutes(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.stallReminderDays ?? 7
  )

  if (periodInMinutes === null) {
    console.log('[Nyatching Background] All checks disabled (Never).')
    return
  }

  browser.alarms.create(ALARM_NAME, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  })

  console.log(`[Nyatching Background] Alarm scheduled every ${periodInMinutes} minutes.`)
}

// ==========================================
// UTILITY HELPERS
// ==========================================

const isTrackedShow = (media: TrackedMedia): media is Show => {
  if (!isShow(media)) return false
  if (!media.tmdbId) return false
  if (!isTrackableStatus(media.status)) return false
  // Opt-in via Track button; legacy undefined counts as off
  return media.tracked === true
}

const isNotifyEnabled = (media: TrackedMedia): boolean => {
  if (media.status !== 'watching') return false
  return media.notifyEnabled === true
}

const getPosterIcon = (media: TrackedMedia): string => {
  if (media.posterPath && media.posterPath.startsWith('http')) {
    return media.posterPath
  }
  return browser.runtime.getURL('img/logo-128.png')
}

// ==========================================
// NEW SEASON POLLING
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
      const notificationId = `nyatching_show_${show.id}_${latestSeasons}_${Date.now()}`

      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: getPosterIcon(show),
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} is available! Click to open dashboard.`,
      })

      await addNotificationLog({
        showId: show.id,
        title: `New Season: ${show.title}`,
        message: `Season ${latestSeasons} has been released!`,
        posterPath: show.posterPath,
      })

      await updateMedia({
        id: show.id,
        totalSeasons: latestSeasons,
        status: 'waiting',
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

// ==========================================
// INACTIVITY (STALL) REMINDERS
// ==========================================

const processStallReminder = async (
  media: TrackedMedia,
  stallReminderDays: number
): Promise<boolean> => {
  const now = Date.now()
  const lastProgress = media.lastProgressUpdate || media.createdAt || now
  const idleMs = now - lastProgress
  const thresholdMs = stallReminderDays * MS_PER_DAY

  if (idleMs < thresholdMs) return false

  // Avoid spam: wait another full threshold since the last stall notification
  if (media.lastStallNotified && now - media.lastStallNotified < thresholdMs) {
    return false
  }

  const progressHint = isShow(media)
    ? `No episode updates for ${stallReminderDays}+ day(s).`
    : `No minute updates for ${stallReminderDays}+ day(s).`

  const notificationId = `nyatching_stall_${media.id}_${Date.now()}`

  await browser.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: getPosterIcon(media),
    title: `Still watching ${media.title}?`,
    message: `${progressHint} Click to open dashboard.`,
  })

  await addNotificationLog({
    showId: media.id,
    title: `Inactive: ${media.title}`,
    message: progressHint,
    posterPath: media.posterPath,
  })

  await updateMedia({
    id: media.id,
    lastStallNotified: now,
  })

  return true
}

export const checkStalledMedia = async (): Promise<void> => {
  const settings = await getSettings()
  const stallReminderDays = settings.stallReminderDays ?? 7

  if (stallReminderDays <= 0) return

  try {
    const allMedia = await getAllMedia()
    const candidates = allMedia.filter(isNotifyEnabled)

    for (const media of candidates) {
      await processStallReminder(media, stallReminderDays)
    }
  } catch (error) {
    console.error('[Nyatching Background] Critical error during stall checks:', error)
  }
}

export const runScheduledChecks = async (): Promise<void> => {
  await checkWaitingShows()
  await checkStalledMedia()
}

if (typeof self !== 'undefined') {
  ;(self as any).checkWaitingShows = checkWaitingShows
  ;(self as any).checkStalledMedia = checkStalledMedia
  ;(self as any).runScheduledChecks = runScheduledChecks
}

// ==========================================
// NOTIFICATION LISTENERS
// ==========================================

browser.notifications.onClicked.addListener(async (notificationId) => {
  if (
    notificationId.startsWith('nyatching_show_') ||
    notificationId.startsWith('nyatching_stall_')
  ) {
    try {
      await browser.runtime.openOptionsPage()
    } catch {
      await browser.tabs.create({
        url: browser.runtime.getURL('src/dashboard/dashboard.html'),
      })
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
    runScheduledChecks()
  }
})

browser.runtime.onMessage.addListener(async (message: unknown) => {
  const msg = message as SystemMessage

  if (msg.type === 'SETTINGS_UPDATED' || msg.action === 'UPDATE_SETTINGS') {
    await setupAlarm()
    return { status: 'success' }
  }

  if (msg.action === 'TRIGGER_CHECK') {
    await runScheduledChecks()
    return { status: 'success' }
  }
})
