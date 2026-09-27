import { TMDBAiredEpisode, compareAiredEpisodes } from '../services/aired-episode'
import { Show, TrackedMedia, isShow, isNotifyEnabled } from '../types'

export const CHECK_AT_HOUR = 12
export const CHECK_AT_MINUTE = 0

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

export const isNotifiableShow = (media: TrackedMedia): media is Show =>
  isShow(media) &&
  isNotifyEnabled(media) &&
  media.status === 'waiting' &&
  Boolean(media.tmdbId)

export const notifyAtOnDate = (now: number = Date.now()): number => {
  const date = new Date(now)
  date.setHours(CHECK_AT_HOUR, CHECK_AT_MINUTE, 0, 0)
  return date.getTime()
}

/** Next local noon (tomorrow if noon has already passed today). */
export const nextNotifyAt = (now: number = Date.now()): number => {
  const todaySlot = notifyAtOnDate(now)
  if (todaySlot > now) return todaySlot
  const tomorrow = new Date(todaySlot)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return tomorrow.getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Local noons between the last check's noon and today's noon. */
const noonsSince = (lastCheckAt: number, now: number): number =>
  Math.round((notifyAtOnDate(now) - notifyAtOnDate(lastCheckAt)) / DAY_MS)

/** Today's noon has arrived, and this interval's noon slot has not run yet. */
export const isNoonCheckDue = (
  intervalHours: number,
  lastCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  if (intervalHours <= 0) return false
  const todaySlot = notifyAtOnDate(now)
  const last = lastCheckAt ?? 0
  if (now < todaySlot || last >= todaySlot) return false
  if (intervalHours <= 24 || last <= 0) return true
  return noonsSince(last, now) * 24 >= intervalHours
}

export const computeNextAlarmWhen = (
  seasonIntervalHours: number,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): number | null => {
  if (seasonIntervalHours <= 0) return null

  let when = nextNotifyAt(now)
  const last = lastReleaseCheckAt ?? 0
  if (last > 0 && seasonIntervalHours > 24) {
    const due = new Date(notifyAtOnDate(last))
    due.setDate(due.getDate() + Math.ceil(seasonIntervalHours / 24))
    while (when < due.getTime()) {
      const nextDay = new Date(when)
      nextDay.setDate(nextDay.getDate() + 1)
      when = nextDay.getTime()
    }
  }
  return when
}

export const shouldCatchUpMissedCheck = (
  seasonIntervalHours: number,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  if ((lastReleaseCheckAt ?? 0) <= 0) return false
  return isNoonCheckDue(seasonIntervalHours, lastReleaseCheckAt, now)
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

const watchHint = (show: Show): string =>
  show.watchingUrl?.trim() ? ' Click to open your watching link.' : ''

export const buildReleaseNotice = (show: Show, next: TMDBAiredEpisode): ReleaseNotice => {
  const isNewSeason = next.season > show.currentSeason
  const episodeLabel = formatEpisodeLabel(next)
  const hint = watchHint(show)
  const watchingUrl = show.watchingUrl?.trim() || undefined
  const kind: ReleaseKind = isNewSeason ? 'new_season' : 'new_episode'

  return {
    kind,
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
  seasonEpisodeCount?: number
): ReleaseCheckResult => {
  if (!latest) {
    return { notify: false, notice: null, updates: metaUpdates }
  }

  const next = nextEpisodeToWatch(show, seasonEpisodeCount)
  if (!hasAired(latest, next)) {
    return { notify: false, notice: null, updates: metaUpdates }
  }

  const alreadyTold =
    show.lastNotifiedSeason === next.season && show.lastNotifiedEpisode === next.episode
  if (alreadyTold) {
    return { notify: false, notice: null, updates: metaUpdates }
  }

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

export const selfCheckReleaseSchedule = (): void => {
  const at = (day: number, hour: number, minute = 0) =>
    new Date(2026, 8, day, hour, minute, 0, 0).getTime()
  const last = at(14, 12, 5)

  if (!isNoonCheckDue(24, last, at(15, 12, 0))) throw new Error('daily noon is due')
  if (isNoonCheckDue(24, last, at(15, 11, 59))) throw new Error('before noon is not due')
  if (isNoonCheckDue(24, at(15, 12, 5), at(15, 13, 0))) throw new Error('already ran this noon')
  if (!isNoonCheckDue(168, last, at(21, 12, 0))) throw new Error('weekly noon is due')
  if (isNoonCheckDue(168, last, at(20, 12, 0))) throw new Error('weekly is early')
  if (isNoonCheckDue(-1, last, at(15, 12, 0))) throw new Error('never is off')
  if (shouldCatchUpMissedCheck(24, undefined, at(15, 12, 0))) throw new Error('first check waits')
  if (!shouldCatchUpMissedCheck(24, last, at(15, 12, 2))) throw new Error('catch-up uses noon')
  if (computeNextAlarmWhen(168, last, at(21, 11, 0)) !== at(21, 12, 0)) {
    throw new Error('weekly alarm stays on the due noon')
  }
  if (computeNextAlarmWhen(24, last, last) !== at(15, 12, 0)) throw new Error('daily alarm is next noon')
}
