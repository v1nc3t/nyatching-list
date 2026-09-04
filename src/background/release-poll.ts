import { getAllMedia, updateMedia, addNotificationLog, getSettings } from '../storage'
import { createOsNotification } from '../utils/notify'
import {
  getTMDBDetails,
  parseTMDBShowInfo,
  getEpisodeCountForSeason,
  getLatestAiredEpisode,
  getTMDBSeasonEpisodes,
  TMDBTvDetails,
} from '../services/tmdb'
import {
  decideReleaseAction,
  isNotifiableShow,
  buildShowMetaUpdates,
  formatEpisodeLabel,
  nextEpisodeToWatch,
  ReleaseNotice,
} from './release-check'
import { Show } from '../types'
import {
  TMDBAiredEpisode,
  compareAiredEpisodes,
  getLatestAiredFromEpisodeList,
  airedEpisodeCountForSeason,
} from '../services/aired-episode'

export const RELEASE_NOTIFICATION_PREFIX = 'nyatching_rel:'

export interface ReleaseCheckSummary {
  checkedCount: number
  notifiedCount: number
  notifiedTitles: string[]
  notes: string[]
}

export const buildReleaseNotificationId = (showId: string): string =>
  `${RELEASE_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}:${Date.now()}`

export const parseReleaseNotificationShowId = (notificationId: string): string | null => {
  if (!notificationId.startsWith(RELEASE_NOTIFICATION_PREFIX)) return null
  const rest = notificationId.slice(RELEASE_NOTIFICATION_PREFIX.length)
  const sep = rest.lastIndexOf(':')
  if (sep <= 0) return null
  try {
    return decodeURIComponent(rest.slice(0, sep))
  } catch {
    return null
  }
}

const sendReleaseNotification = async (show: Show, notice: ReleaseNotice): Promise<void> => {
  await addNotificationLog({
    showId: show.id,
    title: notice.logTitle,
    message: notice.logMessage,
    posterPath: show.posterPath,
    watchingUrl: notice.watchingUrl,
  })

  await createOsNotification({
    id: buildReleaseNotificationId(show.id),
    title: notice.title,
    message: notice.message,
  })
}

const resolveShowTotals = (
  show: Show,
  latest: TMDBAiredEpisode | null,
  tmdbData: TMDBTvDetails | null
): { totalSeasons?: number; totalEpisodes?: number; seasonEpisodeCount?: number } => {
  const showInfo = parseTMDBShowInfo(tmdbData)
  const totalSeasons = showInfo?.totalSeasons ?? tmdbData?.number_of_seasons ?? show.totalSeasons
  const seasonEpisodeCount = showInfo
    ? getEpisodeCountForSeason(showInfo, show.currentSeason)
    : undefined
  const totalEpisodes =
    airedEpisodeCountForSeason(latest, show.currentSeason, seasonEpisodeCount) ?? show.totalEpisodes
  const cappedTotal =
    typeof totalEpisodes === 'number' && totalEpisodes > 0
      ? Math.max(totalEpisodes, show.currentEpisode)
      : totalEpisodes

  return { totalSeasons, totalEpisodes: cappedTotal, seasonEpisodeCount }
}

const resolveLatestAired = async (
  show: Show,
  tmdbData: TMDBTvDetails | null
): Promise<TMDBAiredEpisode | null> => {
  let latest = getLatestAiredEpisode(tmdbData)
  const seasonNumber = latest?.season ?? show.currentSeason

  if (show.tmdbId && seasonNumber) {
    const episodes = await getTMDBSeasonEpisodes(show.tmdbId, seasonNumber)
    if (episodes) {
      const fromSeason = getLatestAiredFromEpisodeList(episodes)
      if (fromSeason && (!latest || compareAiredEpisodes(fromSeason, latest) > 0)) {
        latest = fromSeason
      }
    }
  }

  return latest
}

const processShowRelease = async (
  show: Show,
  remindIfBehind: boolean
): Promise<{ notified: boolean; note?: string }> => {
  if (!show.tmdbId) return { notified: false, note: `${show.title}: missing TMDB id.` }

  try {
    const tmdbData = await getTMDBDetails(show.tmdbId, 'show')
    if (!tmdbData) {
      return { notified: false, note: `${show.title}: TMDB lookup failed.` }
    }

    const latest = await resolveLatestAired(show, tmdbData)
    const { totalSeasons, totalEpisodes, seasonEpisodeCount } = resolveShowTotals(
      show,
      latest,
      tmdbData
    )
    const metaUpdates = buildShowMetaUpdates(totalSeasons, totalEpisodes)
    const decision = decideReleaseAction(show, latest, metaUpdates, {
      remindIfBehind,
      seasonEpisodeCount,
    })

    if (decision.notify && decision.notice) {
      await sendReleaseNotification(show, decision.notice)
    }

    if (Object.keys(decision.updates).length > 0) {
      await updateMedia({ id: show.id, ...decision.updates })
    }

    if (decision.notify) return { notified: true }

    if (!latest) {
      return { notified: false, note: `${show.title}: no aired episodes found on TMDB.` }
    }

    const next = nextEpisodeToWatch(show, seasonEpisodeCount)
    const nextLabel = formatEpisodeLabel(next)
    if (compareAiredEpisodes(latest, next) < 0) {
      return {
        notified: false,
        note: `${show.title}: next up is ${nextLabel}; latest aired is ${formatEpisodeLabel(latest)}.`,
      }
    }

    return {
      notified: false,
      note: `${show.title}: already notified about ${nextLabel}.`,
    }
  } catch (err) {
    console.error(`[Nyatching] Error processing show "${show.title}":`, err)
    return { notified: false, note: `${show.title}: check failed.` }
  }
}

export const checkShowReleases = async (
  options: { force?: boolean } = {}
): Promise<ReleaseCheckSummary> => {
  const summary: ReleaseCheckSummary = {
    checkedCount: 0,
    notifiedCount: 0,
    notifiedTitles: [],
    notes: [],
  }

  const settings = await getSettings()
  const seasonIntervalHours = settings.newSeasonCheckIntervalHours ?? 24
  const stallReminderDays = settings.stallReminderDays ?? 7

  if (!options.force && seasonIntervalHours <= 0 && stallReminderDays <= 0) {
    return summary
  }

  const shows = (await getAllMedia()).filter(isNotifiableShow)
  summary.checkedCount = shows.length

  for (const show of shows) {
    const result = await processShowRelease(show, Boolean(options.force))
    if (result.notified) {
      summary.notifiedCount += 1
      summary.notifiedTitles.push(show.title)
    } else if (result.note) {
      summary.notes.push(result.note)
    }
  }

  return summary
}

/** @deprecated Use checkShowReleases */
export const checkWaitingShows = checkShowReleases
