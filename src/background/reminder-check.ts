import { Show, TrackedMedia, isNotifyEnabled, isShow } from '../types'

export const REMINDERS_PER_DAY = 2
export const RELEASES_PER_DAY = 2

export const activityAt = (media: TrackedMedia): number =>
  media.lastActivityAt ?? media.updatedAt ?? media.createdAt

export const isReminderDue = (
  media: TrackedMedia,
  intervalHours: number,
  now: number = Date.now()
): boolean => {
  if (intervalHours <= 0) return false
  if (media.status !== 'watching' || !isNotifyEnabled(media)) return false
  const intervalMs = intervalHours * 60 * 60 * 1000
  if (now - activityAt(media) < intervalMs) return false
  return now - (media.lastRemindedAt ?? 0) >= intervalMs
}

const startOfLocalDay = (now: number): number => {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

export const countSentToday = (timestamps: Array<number | undefined>, now: number = Date.now()): number => {
  const from = startOfLocalDay(now)
  return timestamps.filter((ts) => (ts ?? 0) >= from).length
}

export const remindersSentToday = (items: TrackedMedia[], now: number = Date.now()): number =>
  countSentToday(
    items.map((item) => item.lastRemindedAt),
    now
  )

export const releasesSentToday = (items: TrackedMedia[], now: number = Date.now()): number =>
  countSentToday(
    items.filter(isShow).map((item) => item.lastReleaseNotifiedAt),
    now
  )

export const takeDaily = <T>(items: T[], alreadySent: number, limit: number): T[] =>
  items.slice(0, Math.max(0, limit - alreadySent))

/** Oldest activity first. Stops at the daily cap, including reminders already sent today. */
export const pickReminders = (
  due: TrackedMedia[],
  alreadySent: number,
  limit: number = REMINDERS_PER_DAY
): TrackedMedia[] =>
  takeDaily(
    [...due].sort((a, b) => activityAt(a) - activityAt(b) || a.id.localeCompare(b.id)),
    alreadySent,
    limit
  )

export const pickReleases = (
  due: Show[],
  alreadySent: number,
  limit: number = RELEASES_PER_DAY
): Show[] => takeDaily([...due].sort((a, b) => a.id.localeCompare(b.id)), alreadySent, limit)

export interface ReminderNotice {
  showId: string
  title: string
  message: string
  logTitle: string
  logMessage: string
  posterPath?: string
  watchingUrl?: string
}

export const buildReminderNotice = (item: TrackedMedia): ReminderNotice => {
  const url = item.watchingUrl?.trim()
  const link = url && /^https?:\/\//i.test(url) ? url : undefined
  const hint = link ? ' Click to open your watching link.' : ''
  return {
    showId: item.id,
    title: item.title,
    message: `Still watching? Update your progress.${hint}`,
    logTitle: item.title,
    logMessage: 'Still watching? Update your progress.',
    posterPath: item.posterPath,
    watchingUrl: link,
  }
}

export const selfCheckReminders = (): void => {
  const hour = 60 * 60 * 1000
  const base: TrackedMedia = {
    id: '1',
    title: 'A',
    mediaType: 'movie',
    status: 'watching',
    watchingUrl: '',
    createdAt: 0,
    updatedAt: 0,
    currentMinutes: 0,
    lastActivityAt: 0,
  }
  const now = 10 * 24 * hour
  if (!isReminderDue(base, 24 * 7, now)) throw new Error('stale watching item should be due')
  if (isReminderDue({ ...base, status: 'waiting' }, 24, now)) throw new Error('waiting is not a reminder')
  if (isReminderDue({ ...base, notify: false }, 24, now)) throw new Error('notify off is not due')
  if (isReminderDue({ ...base, lastRemindedAt: now - hour }, 48, now)) throw new Error('recent reminder blocks')
  if (isReminderDue({ ...base, lastActivityAt: now - hour }, 48, now)) throw new Error('fresh activity blocks')

  const due = [0, 1, 2, 3].map((i) => ({ ...base, id: String(i), lastActivityAt: i * hour }))
  const first = pickReminders(due, 0)
  if (first.map((item) => item.id).join() !== '0,1') throw new Error('oldest two go out first')
  const sent = first.map((item) => ({ ...item, lastRemindedAt: now }))
  const rest = due.filter((item) => !first.some((picked) => picked.id === item.id))
  if (pickReminders(rest, remindersSentToday([...sent, ...rest], now)).length !== 0) {
    throw new Error('cap is 2 reminders per day')
  }
  const shows: Show[] = [0, 1, 2].map((i) => ({
    ...base,
    id: `show-${i}`,
    mediaType: 'show',
    currentSeason: 1,
    currentEpisode: 1,
    lastReleaseNotifiedAt: i < 2 ? now : undefined,
  }))
  const waiting = shows.filter((show) => show.lastReleaseNotifiedAt === undefined)
  if (pickReleases(waiting, releasesSentToday(shows, now)).length !== 0) {
    throw new Error('cap is 2 episode alerts per day')
  }
  const one = buildReminderNotice({ ...base, watchingUrl: 'https://example.com' })
  if (one.showId !== '1' || !one.watchingUrl) throw new Error('one title keeps its own notice')
}
