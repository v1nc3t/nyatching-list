import browser from 'webextension-polyfill'
import { AppSettings } from '../types'
import { getSettings } from '../storage'
import { computeNextAlarmWhen, shouldCatchUpMissedCheck } from './release-check'

export const ALARM_NAME = 'nyatching_daily_check'

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

export const scheduleReleaseCheckAlarm = async (
  settings?: AppSettings
): Promise<{ when: number | null }> => {
  // Drop leftover inactivity alarms from older versions.
  await browser.alarms.clear('nyatching_stall_check')

  const resolved = settings ?? (await getSettings())
  const when = nextCheckTimestamp(resolved)
  await browser.alarms.clear(ALARM_NAME)
  if (!when) {
    console.log('[Nyatching Background] Episode checks disabled (Never).')
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
