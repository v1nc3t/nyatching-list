import { TMDBAiredEpisode, compareAiredEpisodes } from '../services/aired-episode'
import { Show, TrackedMedia, isShow, isNotifyEnabled } from '../types'

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export type ReleaseKind = 'new_season' | 'new_episode'

export interface ReleaseNotice {
  kind: ReleaseKind
  title: string
  message: string
  logTitle: string
  logMessage: string
  watchingUrl?: string
}

export interface ReleaseCheckResult {
  notify: boolean
  notice: ReleaseNotice | null
  updates: Partial<Show>
}

export const isNotifiableShow = (media: TrackedMedia): media is Show => {
  return (
    isShow(media) &&
    isNotifyEnabled(media) &&
    (media.status === 'watching' || media.status === 'waiting') &&
    Boolean(media.tmdbId)
  )
}

export const DEFAULT_NOTIFY_AT = '09:00'

export const parseNotifyAt = (value?: string): { hour: number; minute: number } => {
  const match = /^(\d{1,2}):(\d{2})/.exec(value?.trim() ?? '')
  if (!match) return { hour: 9, minute: 0 }
  const hour = Math.min(23, Math.max(0, Number(match[1])))
  const minute = Math.min(59, Math.max(0, Number(match[2])))
  return { hour, minute }
}

export const formatNotifyAt = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

export const notifyAtOnDate = (at: { hour: number; minute: number }, now: number = Date.now()): number => {
  const date = new Date(now)
  date.setHours(at.hour, at.minute, 0, 0)
  return date.getTime()
}

/** Next local clock time matching notifyAt (tomorrow if it already passed today). */
export const nextNotifyAt = (notifyAt: string | undefined, now: number = Date.now()): number => {
  const parsed = parseNotifyAt(notifyAt)
  const todaySlot = notifyAtOnDate(parsed, now)
  if (todaySlot > now) return todaySlot
  const tomorrow = new Date(todaySlot)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.getTime()
}

export const computeNextAlarmWhen = (
  seasonIntervalHours: number,
  stallReminderDays: number,
  notifyAt: string | undefined,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): number | null => {
  const periodInMinutes = resolveAlarmPeriodMinutes(seasonIntervalHours, stallReminderDays)
  if (periodInMinutes === null) return null

  let when = nextNotifyAt(notifyAt, now)
  const last = lastReleaseCheckAt ?? 0
  if (last > 0 && periodInMinutes > 24 * 60) {
    const earliest = last + periodInMinutes * 60 * 1000
    while (when < earliest) {
      const nextDay = new Date(when)
      nextDay.setDate(nextDay.getDate() + 1)
      when = nextDay.getTime()
    }
  }
  return when
}

export const shouldCatchUpMissedCheck = (
  seasonIntervalHours: number,
  stallReminderDays: number,
  notifyAt: string | undefined,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  const periodInMinutes = resolveAlarmPeriodMinutes(seasonIntervalHours, stallReminderDays)
  if (periodInMinutes === null) return false

  const last = lastReleaseCheckAt ?? 0
  if (last <= 0) return false

  const todaySlot = notifyAtOnDate(parseNotifyAt(notifyAt), now)
  const periodMs = periodInMinutes * 60 * 1000
  return now >= todaySlot && last < todaySlot && now - last >= periodMs
}

export const resolveAlarmPeriodMinutes = (
  seasonIntervalHours: number,
  stallReminderDays: number
): number | null => {
  const candidates: number[] = []

  if (seasonIntervalHours > 0) {
    candidates.push(seasonIntervalHours * 60)
  }

  if (stallReminderDays > 0) {
    candidates.push(24 * 60)
  }

  if (candidates.length === 0) return null
  return Math.max(1, Math.min(...candidates))
}

export const buildShowMetaUpdates = (
  totalSeasons: number | undefined,
  totalEpisodes: number | undefined
): Partial<Show> => {
  const updates: Partial<Show> = {}
  if (typeof totalSeasons === 'number' && totalSeasons > 0) {
    updates.totalSeasons = totalSeasons
  }
  if (typeof totalEpisodes === 'number' && totalEpisodes > 0) {
    updates.totalEpisodes = totalEpisodes
  }
  return updates
}

export const getLastNotified = (show: Show): TMDBAiredEpisode | null => {
  if (typeof show.lastNotifiedSeason !== 'number' || typeof show.lastNotifiedEpisode !== 'number') {
    return null
  }
  return { season: show.lastNotifiedSeason, episode: show.lastNotifiedEpisode }
}

export const formatEpisodeLabel = (latest: TMDBAiredEpisode): string =>
  `Season ${latest.season} Episode ${latest.episode}`

export const nextEpisodeToWatch = (
  show: Show,
  seasonEpisodeCount?: number
): TMDBAiredEpisode => {
  const cap = seasonEpisodeCount && seasonEpisodeCount > 0 ? seasonEpisodeCount : undefined
  if (cap !== undefined && show.currentEpisode >= cap) {
    return { season: show.currentSeason + 1, episode: 1 }
  }
  return { season: show.currentSeason, episode: show.currentEpisode + 1 }
}

const hasAired = (latest: TMDBAiredEpisode, target: TMDBAiredEpisode): boolean =>
  compareAiredEpisodes(latest, target) >= 0

const sameEpisode = (a: TMDBAiredEpisode | null, b: TMDBAiredEpisode): boolean =>
  Boolean(a && a.season === b.season && a.episode === b.episode)

const watchHint = (show: Show): string =>
  show.watchingUrl?.trim() ? ' Click to open your watching link.' : ''

export const buildReleaseNotice = (show: Show, next: TMDBAiredEpisode): ReleaseNotice => {
  const isNewSeason = next.season > show.currentSeason
  const episodeLabel = formatEpisodeLabel(next)
  const hint = watchHint(show)
  const watchingUrl = show.watchingUrl?.trim() || undefined

  if (show.status === 'watching') {
    const nextWhat = isNewSeason ? 'season' : 'episode'
    return {
      kind: isNewSeason ? 'new_season' : 'new_episode',
      title: show.title,
      message: `Reminder to watch the next ${nextWhat} (${episodeLabel}).${hint}`,
      logTitle: show.title,
      logMessage: `Reminder to watch the next ${nextWhat} (${episodeLabel}).`,
      watchingUrl,
    }
  }

  return {
    kind: isNewSeason ? 'new_season' : 'new_episode',
    title: show.title,
    message: `${episodeLabel} is out.${hint}`,
    logTitle: show.title,
    logMessage: `${episodeLabel} is out.`,
    watchingUrl,
  }
}

export const decideReleaseAction = (
  show: Show,
  latest: TMDBAiredEpisode | null,
  metaUpdates: Partial<Show>,
  options: { remindIfBehind?: boolean; seasonEpisodeCount?: number } = {}
): ReleaseCheckResult => {
  if (!latest) {
    return { notify: false, notice: null, updates: metaUpdates }
  }

  const next = nextEpisodeToWatch(show, options.seasonEpisodeCount)

  if (!hasAired(latest, next)) {
    return {
      notify: false,
      notice: null,
      updates: metaUpdates,
    }
  }

  const lastNotified = getLastNotified(show)
  const alreadyTold = sameEpisode(lastNotified, next)

  if (!alreadyTold || options.remindIfBehind) {
    return {
      notify: true,
      notice: buildReleaseNotice(show, next),
      updates: {
        ...metaUpdates,
        lastNotifiedSeason: next.season,
        lastNotifiedEpisode: next.episode,
      },
    }
  }

  return { notify: false, notice: null, updates: metaUpdates }
}
