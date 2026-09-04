import { TMDBAiredEpisode, compareAiredEpisodes } from '../services/aired-episode'
import { Show, TrackedMedia, isShow, isMovie, isNotifyEnabled } from '../types'

export const MS_PER_DAY = 24 * 60 * 60 * 1000
export const CHECK_AT_HOUR = 0
export const CHECK_AT_MINUTE = 0

export type ReleaseKind = 'new_season' | 'new_episode' | 'inactivity'

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

export const isNotifiableForStall = (media: TrackedMedia): boolean => {
  return (
    isNotifyEnabled(media) &&
    (media.status === 'watching' || media.status === 'waiting')
  )
}

export const notifyAtOnDate = (now: number = Date.now()): number => {
  const date = new Date(now)
  date.setHours(CHECK_AT_HOUR, CHECK_AT_MINUTE, 0, 0)
  return date.getTime()
}

/** Next local midnight (tomorrow if midnight has already passed today). */
export const nextNotifyAt = (now: number = Date.now()): number => {
  const todaySlot = notifyAtOnDate(now)
  if (todaySlot > now) return todaySlot
  const tomorrow = new Date(todaySlot)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.getTime()
}

export const computeNextAlarmWhen = (
  seasonIntervalHours: number,
  stallReminderDays: number,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): number | null => {
  const periodInMinutes = resolveAlarmPeriodMinutes(seasonIntervalHours, stallReminderDays)
  if (periodInMinutes === null) return null

  let when = nextNotifyAt(now)
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
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  const periodInMinutes = resolveAlarmPeriodMinutes(seasonIntervalHours, stallReminderDays)
  if (periodInMinutes === null) return false

  const last = lastReleaseCheckAt ?? 0
  if (last <= 0) return false

  const todaySlot = notifyAtOnDate(now)
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

export const isTmdbCheckDue = (
  seasonIntervalHours: number,
  lastTmdbCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  if (seasonIntervalHours <= 0) return false
  if (!lastTmdbCheckAt) return true
  return now - lastTmdbCheckAt >= seasonIntervalHours * 60 * 60 * 1000
}

export const lastMediaActivityAt = (media: TrackedMedia): number =>
  media.lastProgressUpdate || media.createdAt || 0

export const decideStallAction = (
  media: TrackedMedia,
  stallReminderDays: number,
  now: number = Date.now()
): { notify: boolean; notice: ReleaseNotice | null; lastStallNotified?: number } => {
  if (stallReminderDays <= 0 || !isNotifiableForStall(media)) {
    return { notify: false, notice: null }
  }

  const lastActivity = lastMediaActivityAt(media)
  const idleMs = now - lastActivity
  const thresholdMs = stallReminderDays * MS_PER_DAY
  if (idleMs < thresholdMs) {
    return { notify: false, notice: null }
  }

  if (media.lastStallNotified && now - media.lastStallNotified < thresholdMs) {
    return { notify: false, notice: null }
  }

  const idleDays = Math.max(stallReminderDays, Math.floor(idleMs / MS_PER_DAY))
  return {
    notify: true,
    notice: buildStallNotice(media, idleDays),
    lastStallNotified: now,
  }
}

export const buildStallNotice = (media: TrackedMedia, idleDays: number): ReleaseNotice => {
  const daysLabel = idleDays === 1 ? '1 day' : `${idleDays} days`
  const hint = watchHint(media)
  const watchingUrl = media.watchingUrl?.trim() || undefined
  const what = isMovie(media) ? 'movie' : 'show'

  return {
    kind: 'inactivity',
    title: media.title,
    message: `You have not updated this ${what} in ${daysLabel}.${hint}`,
    logTitle: media.title,
    logMessage: `You have not updated this ${what} in ${daysLabel}.`,
    watchingUrl,
  }
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

const watchHint = (media: TrackedMedia): string =>
  media.watchingUrl?.trim() ? ' Click to open your watching link.' : ''

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
