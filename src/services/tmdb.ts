const TMDB_READ_TOKEN = import.meta.env.VITE_TMDB_READ_TOKEN
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185'

export interface TMDBSuggestion {
  id: number
  mediaType: 'show' | 'movie'
  title: string
  year?: number
  posterPath?: string
}

export interface TMDBSeasonInfo {
  seasonNumber: number
  episodeCount: number
}

export interface TMDBShowInfo {
  totalSeasons: number
  seasons: TMDBSeasonInfo[]
  lastSeason: TMDBSeasonInfo
}

export interface TMDBExternalFindResult {
  title: string
  mediaType: 'show' | 'movie'
  tmdbId: number
  posterPath?: string
  totalSeasons?: number
  runtimeMinutes?: number
  releaseYear?: number
  showInfo?: TMDBShowInfo
}

export interface TMDBTvDetails {
  number_of_seasons?: number
  seasons?: { season_number?: number; episode_count?: number }[]
}

export interface TMDBMovieDetails {
  runtime?: number
}

export type CompletedShowProgress = {
  currentSeason: number
  currentEpisode: number
  totalSeasons: number
  totalEpisodes: number
}

const defaultHeaders = {
  Authorization: `Bearer ${TMDB_READ_TOKEN}`,
  'Content-Type': 'application/json'
}

/**
 * Live multi-search for title auto-complete in manual add
 */
export const searchTMDB = async (query: string): Promise<TMDBSuggestion[]> => {
  if (!query.trim() || query.length < 2) return []

  try {
    const res = await fetch(
      `${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&include_adult=false`,
      { headers: defaultHeaders }
    )

    if (!res.ok) return []

    const data = await res.json()

    return data.results
      .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 5)
      .map((item: any) => {
        const isShow = item.media_type === 'tv'
        const dateStr = isShow ? item.first_air_date : item.release_date
        return {
          id: item.id,
          mediaType: isShow ? 'show' : 'movie',
          title: isShow ? item.name : item.title,
          year: dateStr ? new Date(dateStr).getFullYear() : undefined,
          posterPath: item.poster_path ? `${TMDB_IMAGE_BASE_URL}${item.poster_path}` : undefined
        }
      })
  } catch (err) {
    console.error('TMDB Search Error:', err)
    return []
  }
}

/**
 * Fetch detailed show/movie details (seasons or runtime)
 */
export async function getTMDBDetails(id: number, mediaType: 'show'): Promise<TMDBTvDetails | null>
export async function getTMDBDetails(id: number, mediaType: 'movie'): Promise<TMDBMovieDetails | null>
export async function getTMDBDetails(
  id: number,
  mediaType: 'show' | 'movie'
): Promise<TMDBTvDetails | TMDBMovieDetails | null> {
  const endpoint = mediaType === 'show' ? `/tv/${id}` : `/movie/${id}`
  const res = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
    headers: defaultHeaders
  })

  if (!res.ok) return null
  return res.json()
}

export const parseTMDBShowInfo = (details: TMDBTvDetails | null): TMDBShowInfo | null => {
  if (!details) return null

  const seasons: TMDBSeasonInfo[] = (details.seasons ?? [])
    .filter((s): s is { season_number: number; episode_count?: number } =>
      typeof s.season_number === 'number' && s.season_number > 0
    )
    .map((s) => ({
      seasonNumber: s.season_number,
      episodeCount: typeof s.episode_count === 'number' ? s.episode_count : 0,
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber)

  const withEpisodes = seasons.filter((s) => s.episodeCount > 0)
  const lastSeason = (withEpisodes.length > 0 ? withEpisodes : seasons).at(-1)
  const totalSeasons =
    typeof details.number_of_seasons === 'number' && details.number_of_seasons > 0
      ? details.number_of_seasons
      : lastSeason?.seasonNumber

  if (!totalSeasons) return null

  return {
    totalSeasons,
    seasons,
    lastSeason: lastSeason
      ? { ...lastSeason, episodeCount: Math.max(1, lastSeason.episodeCount) }
      : { seasonNumber: totalSeasons, episodeCount: 1 },
  }
}

export const getTMDBShowInfo = async (id: number): Promise<TMDBShowInfo | null> => {
  const details = await getTMDBDetails(id, 'show')
  return parseTMDBShowInfo(details)
}

export const getEpisodeCountForSeason = (
  info: TMDBShowInfo,
  seasonNumber: number
): number | undefined => {
  return info.seasons.find((s) => s.seasonNumber === seasonNumber)?.episodeCount
}

export const completedProgressFromShowInfo = (info: TMDBShowInfo): CompletedShowProgress => ({
  currentSeason: info.lastSeason.seasonNumber,
  currentEpisode: info.lastSeason.episodeCount,
  totalSeasons: info.totalSeasons,
  totalEpisodes: info.lastSeason.episodeCount,
})

export const resolveCompletedShowProgress = async (
  tmdbId: number | undefined,
  fallback: {
    totalSeasons?: number
    totalEpisodes?: number
    currentSeason: number
    currentEpisode: number
  }
): Promise<CompletedShowProgress | null> => {
  if (tmdbId) {
    const info = await getTMDBShowInfo(tmdbId)
    if (info) return completedProgressFromShowInfo(info)
  }

  const season = fallback.totalSeasons && fallback.totalSeasons > 0
    ? fallback.totalSeasons
    : fallback.currentSeason
  const episode = fallback.totalEpisodes && fallback.totalEpisodes > 0
    ? fallback.totalEpisodes
    : fallback.currentEpisode

  if (!season) return null

  return {
    currentSeason: season,
    currentEpisode: episode || 1,
    totalSeasons: fallback.totalSeasons ?? season,
    totalEpisodes: fallback.totalEpisodes ?? episode ?? 1,
  }
}

export const resolveCompletedMovieProgress = async (
  tmdbId: number | undefined,
  fallback: { runtimeMinutes?: number; currentMinutes: number }
): Promise<{ currentMinutes: number; runtimeMinutes?: number }> => {
  let runtime = fallback.runtimeMinutes

  if ((!runtime || runtime <= 0) && tmdbId) {
    const details = await getTMDBDetails(tmdbId, 'movie')
    if (details?.runtime && details.runtime > 0) {
      runtime = details.runtime
    }
  }

  return {
    currentMinutes: runtime && runtime > 0 ? runtime : fallback.currentMinutes,
    runtimeMinutes: runtime,
  }
}

/**
 * Looks up TMDB metadata directly using an IMDb ID (e.g. tt0903747)
 */
export const fetchTmdbByImdbId = async (
  imdbId: string
): Promise<TMDBExternalFindResult | null> => {
  if (!imdbId.trim()) return null

  try {
    const res = await fetch(
      `${TMDB_BASE_URL}/find/${imdbId}?external_source=imdb_id`,
      { headers: defaultHeaders }
    )

    if (!res.ok) return null

    const data = await res.json()

    // 1. Check TV Show matches
    if (data.tv_results && data.tv_results.length > 0) {
      const show = data.tv_results[0]
      const details = await getTMDBDetails(show.id, 'show')
      const showInfo = parseTMDBShowInfo(details)

      return {
        title: show.name || show.original_name,
        mediaType: 'show',
        tmdbId: show.id,
        posterPath: show.poster_path
          ? `${TMDB_IMAGE_BASE_URL}${show.poster_path}`
          : undefined,
        totalSeasons: showInfo?.totalSeasons ?? details?.number_of_seasons,
        releaseYear: show.first_air_date
          ? new Date(show.first_air_date).getFullYear()
          : undefined,
        showInfo: showInfo ?? undefined,
      }
    }

    // 2. Check Movie matches
    if (data.movie_results && data.movie_results.length > 0) {
      const movie = data.movie_results[0]
      const details = await getTMDBDetails(movie.id, 'movie')

      return {
        title: movie.title || movie.original_title,
        mediaType: 'movie',
        tmdbId: movie.id,
        posterPath: movie.poster_path
          ? `${TMDB_IMAGE_BASE_URL}${movie.poster_path}`
          : undefined,
        runtimeMinutes: details?.runtime,
        releaseYear: movie.release_date
          ? new Date(movie.release_date).getFullYear()
          : undefined
      }
    }

    return null
  } catch (err) {
    console.error('TMDB External Find Error:', err)
    return null
  }
}