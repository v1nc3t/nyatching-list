import browser from 'webextension-polyfill'
import { AppSettings } from '../types'
import { getSettings } from '../storage'
import {
  computeNextAlarmWhen,
  isNoonCheckDue,
  nextNotifyAt,
  notifyAtOnDate,
  shouldCatchUpMissedCheck,
} from './release-check'

export const ALARM_NAME = 'nyatching_daily_check'

export const nextReleaseCheckTimestamp = (
  settings: AppSettings,
  now: number = Date.now()
): number | null => {
  return computeNextAlarmWhen(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.lastReleaseCheckAt,
    now
  )
}

export const nextReminderCheckTimestamp = (
  settings: AppSettings,
  now: number = Date.now()
): number | null => {
  if ((settings.reminderIntervalHours ?? -1) <= 0) return null
  return nextNotifyAt(now)
}

export const nextCheckTimestamp = (settings: AppSettings, now: number = Date.now()): number | null => {
  const times = [nextReleaseCheckTimestamp(settings, now), nextReminderCheckTimestamp(settings, now)].filter(
    (when): when is number => when !== null
  )
  if (times.length === 0) return null
  return Math.min(...times)
}

export const isReleaseCheckDue = (settings: AppSettings, now: number = Date.now()): boolean =>
  isNoonCheckDue(settings.newSeasonCheckIntervalHours ?? 24, settings.lastReleaseCheckAt, now)

export const scheduleReleaseCheckAlarm = async (
  settings?: AppSettings
): Promise<{ when: number | null }> => {
  // Drop leftover inactivity alarms from older versions.
  await browser.alarms.clear('nyatching_stall_check')

  const resolved = settings ?? (await getSettings())
  const when = nextCheckTimestamp(resolved)
  await browser.alarms.clear(ALARM_NAME)
  if (!when) {
    console.log('[Nyatching Background] Episode checks and reminders are off (Never).')
    return { when: null }
  }

  const delayInMinutes = Math.max(1, Math.ceil((when - Date.now()) / 60000))
  await browser.alarms.create(ALARM_NAME, { delayInMinutes })
  console.log(
    `[Nyatching Background] ${ALARM_NAME} at ${new Date(when).toLocaleString()} (in ${delayInMinutes} min).`
  )
  return { when }
}

export const isMissedScheduledCheck = (settings: AppSettings, now: number = Date.now()): boolean => {
  return shouldCatchUpMissedCheck(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.lastReleaseCheckAt,
    now
  )
}

export const isMissedReminderCheck = (settings: AppSettings, now: number = Date.now()): boolean => {
  if ((settings.reminderIntervalHours ?? -1) <= 0) return false
  const last = settings.lastReminderCheckAt ?? 0
  if (last <= 0) return false
  const todaySlot = notifyAtOnDate(now)
  return now >= todaySlot && last < todaySlot
}
