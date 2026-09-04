import { TMDBAiredEpisode, compareAiredEpisodes } from '../services/aired-episode'
import { Show, TrackedMedia, isShow } from '../types'

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
  return isShow(media) && (media.status === 'watching' || media.status === 'waiting') && Boolean(media.tmdbId)
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
