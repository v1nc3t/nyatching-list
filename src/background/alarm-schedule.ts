import browser from 'webextension-polyfill'
import { AppSettings } from '../types'
import { getSettings } from '../storage'
import {
  computeNextAlarmWhen,
  shouldCatchUpMissedCheck,
} from './release-check'

export const ALARM_NAME = 'nyatching_daily_check'

export const nextCheckTimestamp = (settings: AppSettings, now: number = Date.now()): number | null => {
  return computeNextAlarmWhen(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.stallReminderDays ?? 7,
    settings.lastReleaseCheckAt,
    now
  )
}

export const formatNextCheckLabel = (when: number | null, now: number = Date.now()): string => {
  if (!when) return 'Notifications are off (both frequencies are Never).'
  const whenDate = new Date(when)
  const time = whenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const startOfWhen = new Date(when)
  startOfWhen.setHours(0, 0, 0, 0)
  const startOfNow = new Date(now)
  startOfNow.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((startOfWhen.getTime() - startOfNow.getTime()) / 86400000)
  if (dayDiff <= 0) return `Next check today at ${time}.`
  if (dayDiff === 1) return `Next check tomorrow at ${time}.`
  return `Next check ${whenDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}.`
}

const delayMinutesUntil = (when: number): number => {
  const minutes = (when - Date.now()) / 60000
  return Math.max(1, Math.ceil(minutes))
}

const clearAndCreateAlarm = async (delayInMinutes: number): Promise<void> => {
  await browser.alarms.clear(ALARM_NAME)
  await browser.alarms.create(ALARM_NAME, { delayInMinutes })
}

export const scheduleReleaseCheckAlarm = async (
  settings?: AppSettings
): Promise<{ when: number | null }> => {
  const resolved = settings ?? (await getSettings())
  const when = nextCheckTimestamp(resolved)
  if (when === null) {
    await browser.alarms.clear(ALARM_NAME)
    console.log('[Nyatching Background] All checks disabled (Never).')
    return { when: null }
  }

  const delayInMinutes = delayMinutesUntil(when)
  await clearAndCreateAlarm(delayInMinutes)
  console.log(
    `[Nyatching Background] Next check at ${new Date(when).toLocaleString()} (in ${delayInMinutes} min).`
  )
  return { when }
}

export const isMissedScheduledCheck = (settings: AppSettings, now: number = Date.now()): boolean => {
  return shouldCatchUpMissedCheck(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.stallReminderDays ?? 7,
    settings.lastReleaseCheckAt,
    now
  )
}
