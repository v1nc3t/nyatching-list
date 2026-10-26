import { MediaStatus, Movie, Show } from '../types'
import { updateMedia } from '../storage'
import { getTMDBShowInfo, statusAfterShowProgress, TMDBShowInfo } from './tmdb'

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
