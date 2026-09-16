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
  buildShowMetaUpdates,
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

export const buildReleaseNotificationId = (showId: string): string =>
  `${RELEASE_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}_${Date.now()}`

export const buildStallNotificationId = (showId: string): string =>
  `${STALL_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}_${Date.now()}`

export const parseReleaseNotificationShowId = (notificationId: string): string | null => {
  const prefixes = [RELEASE_NOTIFICATION_PREFIX, STALL_NOTIFICATION_PREFIX, 'nyatching_rel:']
  const prefix = prefixes.find((p) => notificationId.startsWith(p))
  if (!prefix) return null
  const rest = notificationId.slice(prefix.length)
  const sep = Math.max(rest.lastIndexOf('_'), rest.lastIndexOf(':'))
  if (sep <= 0) return null
  try {
    return decodeURIComponent(rest.slice(0, sep))
  } catch {
    return null
  }
}

const sendNotice = async (media: TrackedMedia, notice: ReleaseNotice, id: string): Promise<void> => {
  await addNotificationLog({
    showId: media.id,
    title: notice.logTitle,
    message: notice.logMessage,
    posterPath: media.posterPath,
    watchingUrl: notice.watchingUrl,
  })
  const shown = await createOsNotification({
    id,
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
  if (!show.tmdbId || !seasonNumber) return latest

  const episodes = await getTMDBSeasonEpisodes(show.tmdbId, seasonNumber)
  if (!episodes) return latest
  const fromSeason = getLatestAiredFromEpisodeList(episodes)
  if (fromSeason && (!latest || compareAiredEpisodes(fromSeason, latest) > 0)) {
    return fromSeason
  }
  return latest
}

const processShowRelease = async (show: Show): Promise<void> => {
  if (!show.tmdbId) return

  try {
    const tmdbData = await getTMDBDetails(show.tmdbId, 'show')
    if (!tmdbData) return

    const latest = await resolveLatestAired(show, tmdbData)
    const { totalSeasons, totalEpisodes, seasonEpisodeCount } = resolveShowTotals(
      show,
      latest,
      tmdbData
    )
    const decision = decideReleaseAction(
      show,
      latest,
      buildShowMetaUpdates(totalSeasons, totalEpisodes),
      seasonEpisodeCount
    )

    if (decision.notify && decision.notice) {
      await sendNotice(show, decision.notice, buildReleaseNotificationId(show.id))
    }
    if (Object.keys(decision.updates).length > 0) {
      await updateMedia({ id: show.id, ...decision.updates })
    }
  } catch (err) {
    console.error(`[Nyatching] Error processing show "${show.title}":`, err)
  }
}

export const checkStallReminders = async (): Promise<void> => {
  const stallReminderDays = (await getSettings()).stallReminderDays ?? 7
  if (stallReminderDays <= 0) return

  for (const item of (await getAllMedia()).filter(isNotifiableForStall)) {
    const decision = decideStallAction(item, stallReminderDays)
    if (!decision.notify || !decision.notice) continue
    await sendNotice(item, decision.notice, buildStallNotificationId(item.id))
    await updateMedia({ id: item.id, lastStallNotified: decision.lastStallNotified })
  }
}

export const checkShowReleases = async (): Promise<void> => {
  const seasonIntervalHours = (await getSettings()).newSeasonCheckIntervalHours ?? 24
  if (seasonIntervalHours <= 0) return

  for (const show of (await getAllMedia()).filter(isNotifiableShow)) {
    await processShowRelease(show)
  }
  await saveSettings({ lastReleaseCheckAt: Date.now() })
}
