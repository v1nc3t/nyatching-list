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
import { decideReleaseAction, isNotifiableShow, buildShowMetaUpdates, ReleaseNotice } from './release-check'
import {
  buildReminderNotice,
  isReminderDue,
  pickReleases,
  pickReminders,
  releasesSentToday,
  remindersSentToday,
} from './reminder-check'
import { Show, TrackedMedia } from '../types'
import {
  TMDBAiredEpisode,
  compareAiredEpisodes,
  getLatestAiredFromEpisodeList,
  airedEpisodeCountForSeason,
} from '../services/aired-episode'

export const RELEASE_NOTIFICATION_PREFIX = 'nyatching_rel_'

export const buildReleaseNotificationId = (showId: string): string =>
  `${RELEASE_NOTIFICATION_PREFIX}${encodeURIComponent(showId)}_${Date.now()}`

export const parseReleaseNotificationShowId = (notificationId: string): string | null => {
  const prefixes = [RELEASE_NOTIFICATION_PREFIX, 'nyatching_stall_', 'nyatching_rel:']
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

type PendingRelease = {
  show: Show
  notice: ReleaseNotice
  lastNotifiedSeason: number
  lastNotifiedEpisode: number
}

const processShowRelease = async (show: Show): Promise<PendingRelease | null> => {
  if (!show.tmdbId) return null

  try {
    const tmdbData = await getTMDBDetails(show.tmdbId, 'show')
    if (!tmdbData) return null

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

    const { lastNotifiedSeason, lastNotifiedEpisode, ...meta } = decision.updates
    if (Object.keys(meta).length > 0) {
      await updateMedia({ id: show.id, ...meta })
    }
    if (
      !decision.notify ||
      !decision.notice ||
      lastNotifiedSeason === undefined ||
      lastNotifiedEpisode === undefined
    ) {
      return null
    }
    return {
      show,
      notice: decision.notice,
      lastNotifiedSeason,
      lastNotifiedEpisode,
    }
  } catch (err) {
    console.error(`[Nyatching] Error processing show "${show.title}":`, err)
    return null
  }
}

export const checkShowReleases = async (): Promise<void> => {
  const seasonIntervalHours = (await getSettings()).newSeasonCheckIntervalHours ?? 24
  if (seasonIntervalHours <= 0) return

  const now = Date.now()
  const all = await getAllMedia()
  const pending: PendingRelease[] = []
  for (const show of all.filter(isNotifiableShow)) {
    const found = await processShowRelease(show)
    if (found) pending.push(found)
  }

  const pendingById = new Map(pending.map((item) => [item.show.id, item]))
  for (const show of pickReleases(
    pending.map((item) => item.show),
    releasesSentToday(all, now)
  )) {
    const item = pendingById.get(show.id)
    if (!item) continue
    await sendNotice(item.show, item.notice, buildReleaseNotificationId(item.show.id))
    await updateMedia({
      id: item.show.id,
      lastNotifiedSeason: item.lastNotifiedSeason,
      lastNotifiedEpisode: item.lastNotifiedEpisode,
      lastReleaseNotifiedAt: now,
    })
  }
  await saveSettings({ lastReleaseCheckAt: now })
}

export const checkReminders = async (): Promise<void> => {
  const intervalHours = (await getSettings()).reminderIntervalHours ?? -1
  if (intervalHours <= 0) return

  const now = Date.now()
  const all = await getAllMedia()
  const due = all.filter((item) => isReminderDue(item, intervalHours, now))
  for (const item of pickReminders(due, remindersSentToday(all, now))) {
    const notice = buildReminderNotice(item)
    await addNotificationLog({
      showId: notice.showId,
      title: notice.logTitle,
      message: notice.logMessage,
      posterPath: notice.posterPath,
      watchingUrl: notice.watchingUrl,
    })
    const shown = await createOsNotification({
      id: buildReleaseNotificationId(notice.showId),
      title: notice.title,
      message: notice.message,
    })
    if (!shown) {
      console.error('[Nyatching List] OS notification was not shown for', item.title)
    }
    await updateMedia({
      id: item.id,
      lastRemindedAt: now,
      lastActivityAt: item.lastActivityAt ?? item.updatedAt,
    })
  }
  await saveSettings({ lastReminderCheckAt: now })
}
