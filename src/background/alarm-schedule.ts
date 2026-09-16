import browser from 'webextension-polyfill'
import { AppSettings } from '../types'
import { getAllMedia, getSettings } from '../storage'
import {
  computeNextAlarmWhen,
  earliestStallDueAt,
  shouldCatchUpMissedCheck,
} from './release-check'

export const ALARM_NAME = 'nyatching_daily_check'
export const STALL_ALARM_NAME = 'nyatching_stall_check'

export const nextCheckTimestamp = (settings: AppSettings, now: number = Date.now()): number | null => {
  return computeNextAlarmWhen(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.lastReleaseCheckAt,
    now
  )
}

export const formatNextCheckLabel = (when: number | null, now: number = Date.now()): string => {
  if (!when) return 'Episode checks are off (Never).'
  const whenDate = new Date(when)
  const time = whenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const startOfWhen = new Date(when)
  startOfWhen.setHours(0, 0, 0, 0)
  const startOfNow = new Date(now)
  startOfNow.setHours(0, 0, 0, 0)
  const dayDiff = Math.round((startOfWhen.getTime() - startOfNow.getTime()) / 86400000)
  if (dayDiff <= 0) return `Next episode check today at ${time}.`
  if (dayDiff === 1) return `Next episode check tomorrow at ${time}.`
  return `Next episode check ${whenDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}.`
}

const delayMinutesUntil = (when: number): number => {
  const minutes = (when - Date.now()) / 60000
  return Math.max(1, Math.ceil(minutes))
}

const setAlarm = async (name: string, when: number | null): Promise<void> => {
  await browser.alarms.clear(name)
  if (when === null) return
  const delayInMinutes = delayMinutesUntil(when)
  await browser.alarms.create(name, { delayInMinutes })
  console.log(
    `[Nyatching Background] ${name} at ${new Date(when).toLocaleString()} (in ${delayInMinutes} min).`
  )
}

export const scheduleReleaseCheckAlarm = async (
  settings?: AppSettings
): Promise<{ when: number | null }> => {
  const resolved = settings ?? (await getSettings())
  const when = nextCheckTimestamp(resolved)
  if (!when) console.log('[Nyatching Background] Episode checks disabled (Never).')
  await setAlarm(ALARM_NAME, when)
  return { when }
}

export const scheduleStallAlarm = async (settings?: AppSettings): Promise<{ when: number | null }> => {
  const resolved = settings ?? (await getSettings())
  const stallDays = resolved.stallReminderDays ?? 7
  if (stallDays <= 0) {
    await browser.alarms.clear(STALL_ALARM_NAME)
    console.log('[Nyatching Background] Inactivity reminders disabled (Never).')
    return { when: null }
  }
  const when = earliestStallDueAt(await getAllMedia(), stallDays)
  if (when === null) {
    await browser.alarms.clear(STALL_ALARM_NAME)
    return { when: null }
  }
  await setAlarm(STALL_ALARM_NAME, when)
  return { when }
}

export const scheduleAllAlarms = async (settings?: AppSettings): Promise<void> => {
  const resolved = settings ?? (await getSettings())
  await scheduleReleaseCheckAlarm(resolved)
  await scheduleStallAlarm(resolved)
}

export const isMissedScheduledCheck = (settings: AppSettings, now: number = Date.now()): boolean => {
  return shouldCatchUpMissedCheck(
    settings.newSeasonCheckIntervalHours ?? 24,
    settings.lastReleaseCheckAt,
    now
  )
}

export const isMissedStallCheck = async (
  settings: AppSettings,
  now: number = Date.now()
): Promise<boolean> => {
  const stallDays = settings.stallReminderDays ?? 7
  if (stallDays <= 0) return false
  const when = earliestStallDueAt(await getAllMedia(), stallDays)
  return when !== null && when <= now
}
