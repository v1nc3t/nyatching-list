import { MediaStatus, Movie, Show, TrackedMedia, isShow } from '../types'
import { updateMedia } from '../storage'
import {
  getTMDBShowInfo,
  statusAfterShowProgress,
  getAiredEpisodeCountForSeason,
  completedProgressFromShowInfo,
  resolveCompletedShowProgress,
  resolveCompletedMovieProgress,
  TMDBShowInfo,
} from './tmdb'

// Progress steps shared by the dashboard cards and the popup quick list

const showInfoCache = new Map<number, TMDBShowInfo>()

export const loadShowInfo = async (tmdbId: number): Promise<TMDBShowInfo | null> => {
  const cached = showInfoCache.get(tmdbId)
  if (cached) return cached
  try {
    const info = await getTMDBShowInfo(tmdbId)
    if (info) showInfoCache.set(tmdbId, info)
    return info
  } catch {
    return null
  }
}

export const stepEpisode = async (show: Show, delta: number) => {
  const floor = show.status === 'next' ? 0 : 1
  let nextEpisode = Math.max(floor, show.currentEpisode + delta)
  if (show.totalEpisodes && show.totalEpisodes > 0) {
    nextEpisode = Math.min(nextEpisode, show.totalEpisodes)
  }

  const info = show.tmdbId ? await loadShowInfo(show.tmdbId) : null
  const updatedStatus = statusAfterShowProgress({
    status: show.status,
    season: show.currentSeason,
    episode: show.currentEpisode,
    nextSeason: show.currentSeason,
    nextEpisode,
    info,
  })

  const updates: Partial<Show> & { id: string } = {
    id: show.id,
    currentEpisode: nextEpisode,
    status: updatedStatus,
  }
  if (updatedStatus === 'watching' && show.currentSeason < 1 && nextEpisode > 0) updates.currentSeason = 1

  await updateMedia(updates)
}

export const stepMinutes = async (movie: Movie, delta: number) => {
  let nextMinutes = Math.max(0, movie.currentMinutes + delta)
  let updatedStatus: MediaStatus = movie.status

  if (movie.runtimeMinutes && movie.runtimeMinutes > 0) {
    if (nextMinutes >= movie.runtimeMinutes) {
      nextMinutes = movie.runtimeMinutes
      updatedStatus = 'completed'
    } else if (movie.status === 'next' && nextMinutes !== movie.currentMinutes) {
      updatedStatus = 'watching'
    } else if (delta < 0 && movie.status === 'completed') {
      updatedStatus = 'watching'
    }
  } else if (movie.status === 'next' && nextMinutes !== movie.currentMinutes) {
    updatedStatus = 'watching'
  }

  await updateMedia({ id: movie.id, currentMinutes: nextMinutes, status: updatedStatus })
}

// A season step starts the new season at episode 1
export const stepSeason = async (show: Show, delta: number) => {
  const floor = show.status === 'next' ? 0 : 1
  let nextSeason = Math.max(floor, show.currentSeason + delta)

  if (show.totalSeasons && show.totalSeasons > 0) {
    nextSeason = Math.min(nextSeason, show.totalSeasons)
  }

  const info = show.tmdbId ? await loadShowInfo(show.tmdbId) : null
  const updates: Partial<Show> & { id: string } = {
    id: show.id,
    currentSeason: nextSeason,
    currentEpisode: 1,
    status: statusAfterShowProgress({
      status: show.status,
      season: show.currentSeason,
      episode: show.currentEpisode,
      nextSeason,
      nextEpisode: 1,
      info,
    }),
  }

  if (info) {
    const airedCount = getAiredEpisodeCountForSeason(info, nextSeason)
    updates.totalEpisodes = airedCount || undefined
  }

  await updateMedia(updates)
}

// Next up resets progress; completed jumps to the end
export const changeStatus = async (item: TrackedMedia, newStatus: MediaStatus) => {
  if (isShow(item)) {
    const updates: Partial<Show> & { id: string } = { id: item.id, status: newStatus }

    if (newStatus === 'next') {
      updates.currentSeason = 0
      updates.currentEpisode = 0
    } else if (newStatus === 'completed') {
      let progress = null
      if (item.tmdbId) {
        const info = await loadShowInfo(item.tmdbId)
        if (info) progress = completedProgressFromShowInfo(info)
      }
      if (!progress) {
        progress = await resolveCompletedShowProgress(undefined, item)
      }
      if (progress) {
        updates.currentSeason = progress.currentSeason
        updates.currentEpisode = progress.currentEpisode
        updates.totalSeasons = progress.totalSeasons
        updates.totalEpisodes = progress.totalEpisodes
      }
    } else if (item.status === 'next') {
      if (item.currentSeason < 1) updates.currentSeason = 1
      if (item.currentEpisode < 1) updates.currentEpisode = 1
    }

    await updateMedia(updates)
    return
  }

  const updates: Partial<Movie> & { id: string } = { id: item.id, status: newStatus }

  if (newStatus === 'next') {
    updates.currentMinutes = 0
  } else if (newStatus === 'completed') {
    const progress = await resolveCompletedMovieProgress(item.tmdbId, item)
    updates.currentMinutes = progress.currentMinutes
    if (progress.runtimeMinutes) {
      updates.runtimeMinutes = progress.runtimeMinutes
    }
  }

  await updateMedia(updates)
}
