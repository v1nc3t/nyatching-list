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
  (media.status === 'watching' || media.status === 'waiting') &&
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

export const computeNextAlarmWhen = (
  seasonIntervalHours: number,
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): number | null => {
  if (seasonIntervalHours <= 0) return null
  const periodInMinutes = Math.max(1, seasonIntervalHours * 60)

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
  lastReleaseCheckAt: number | undefined,
  now: number = Date.now()
): boolean => {
  if (seasonIntervalHours <= 0) return false

  const last = lastReleaseCheckAt ?? 0
  if (last <= 0) return false

  const todaySlot = notifyAtOnDate(now)
  const periodMs = seasonIntervalHours * 60 * 60 * 1000
  return now >= todaySlot && last < todaySlot && now - last >= periodMs
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
  const nextWhat = isNewSeason ? 'season' : 'episode'

  if (show.status === 'watching') {
    return {
      kind,
      title: show.title,
      message: `The next ${nextWhat} is out (${episodeLabel}).${hint}`,
      logTitle: show.title,
      logMessage: `The next ${nextWhat} is out (${episodeLabel}).`,
      watchingUrl,
    }
  }

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
