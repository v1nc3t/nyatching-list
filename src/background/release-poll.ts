import { getAllMedia, updateMedia, addNotificationLog, getSettings, saveSettings } from '../storage'
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
  decideStallAction,
  isNotifiableShow,
  isNotifiableForStall,
  isTmdbCheckDue,
  buildShowMetaUpdates,
  formatEpisodeLabel,
  nextEpisodeToWatch,
  ReleaseNotice,
} from './release-check'
import { Show, TrackedMedia } from '../types'
import {
  TMDBAiredEpisode,
  compareAiredEpisodes,
  getLatestAiredFromEpisodeList,
  airedEpisodeCountForSeason,
} from '../services/aired-episode'

export const RELEASE_NOTIFICATION_PREFIX = 'nyatching_rel_'
export const STALL_NOTIFICATION_PREFIX = 'nyatching_stall_'
const LEGACY_RELEASE_NOTIFICATION_PREFIX = 'nyatching_rel:'

export interface ReleaseCheckSummary {
  checkedCount: number
  notifiedCount: number
  notifiedTitles: string[]
  notes: string[]
}

export const buildReleaseNotificationId = (showId: string): string =>
  `${RELEASE_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}_${Date.now()}`

export const buildStallNotificationId = (showId: string): string =>
  `${STALL_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}_${Date.now()}`

export const parseReleaseNotificationShowId = (notificationId: string): string | null => {
  const rest = notificationId.startsWith(LEGACY_RELEASE_NOTIFICATION_PREFIX)
    ? notificationId.slice(LEGACY_RELEASE_NOTIFICATION_PREFIX.length)
    : notificationId.startsWith(RELEASE_NOTIFICATION_PREFIX)
      ? notificationId.slice(RELEASE_NOTIFICATION_PREFIX.length)
      : notificationId.startsWith(STALL_NOTIFICATION_PREFIX)
        ? notificationId.slice(STALL_NOTIFICATION_PREFIX.length)
        : null
  if (!rest) return null

  const sep = Math.max(rest.lastIndexOf('_'), rest.lastIndexOf(':'))
  if (sep <= 0) return null
  try {
    return decodeURIComponent(rest.slice(0, sep))
  } catch {
    return null
  }
}

const sendReleaseNotification = async (media: TrackedMedia, notice: ReleaseNotice): Promise<void> => {
  await addNotificationLog({
    showId: media.id,
    title: notice.logTitle,
    message: notice.logMessage,
    posterPath: media.posterPath,
    watchingUrl: notice.watchingUrl,
  })

  const shown = await createOsNotification({
    id: buildReleaseNotificationId(media.id),
    title: notice.title,
    message: notice.message,
  })
  if (!shown) {
    console.error('[Nyatching List] OS notification was not shown for', media.title)
  }
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

const processStallReminder = async (
  media: TrackedMedia,
  stallReminderDays: number
): Promise<{ notified: boolean; note?: string }> => {
  const decision = decideStallAction(media, stallReminderDays)
  if (decision.notify && decision.notice) {
    await addNotificationLog({
      showId: media.id,
      title: decision.notice.logTitle,
      message: decision.notice.logMessage,
      posterPath: media.posterPath,
      watchingUrl: decision.notice.watchingUrl,
    })
    const shown = await createOsNotification({
      id: buildStallNotificationId(media.id),
      title: decision.notice.title,
      message: decision.notice.message,
    })
    if (!shown) {
      console.error('[Nyatching List] OS notification was not shown for', media.title)
    }
    await updateMedia({ id: media.id, lastStallNotified: decision.lastStallNotified })
    return { notified: true }
  }
  return { notified: false }
}

export const checkStallReminders = async (): Promise<void> => {
  const settings = await getSettings()
  const stallReminderDays = settings.stallReminderDays ?? 7
  if (stallReminderDays <= 0) return

  const targets = (await getAllMedia()).filter(isNotifiableForStall)
  for (const item of targets) {
    await processStallReminder(item, stallReminderDays)
  }
}

export const checkShowReleases = async (
  options: { force?: boolean; showId?: string } = {}
): Promise<ReleaseCheckSummary> => {
  const summary: ReleaseCheckSummary = {
    checkedCount: 0,
    notifiedCount: 0,
    notifiedTitles: [],
    notes: [],
  }

  const settings = await getSettings()
  const seasonIntervalHours = settings.newSeasonCheckIntervalHours ?? 24

  if (!options.showId && !options.force && seasonIntervalHours <= 0) {
    return summary
  }

  const mediaList = await getAllMedia()
  const targeted = mediaList.filter((item) => !options.showId || item.id === options.showId)

  const tmdbDue =
    seasonIntervalHours > 0 &&
    (Boolean(options.showId) ||
      Boolean(options.force) ||
      isTmdbCheckDue(seasonIntervalHours, settings.lastTmdbCheckAt))

  if (tmdbDue) {
    const shows = targeted.filter(isNotifiableShow)
    summary.checkedCount += shows.length
    for (const show of shows) {
      const result = await processShowRelease(show, Boolean(options.force) || !options.showId)
      if (result.notified) {
        summary.notifiedCount += 1
        summary.notifiedTitles.push(show.title)
      } else if (result.note) {
        summary.notes.push(result.note)
      }
    }
    if (!options.showId) {
      await saveSettings({ lastTmdbCheckAt: Date.now(), lastReleaseCheckAt: Date.now() })
    }
  } else if (!options.showId) {
    await saveSettings({ lastReleaseCheckAt: Date.now() })
  }

  return summary
}

/** @deprecated Use checkShowReleases */
export const checkWaitingShows = checkShowReleases
