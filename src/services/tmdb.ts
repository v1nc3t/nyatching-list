// Replace with your actual TMDB Bearer Token from https://www.themoviedb.org/settings/api
const TMDB_READ_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJhNGFjMjQyNTcxYzIzMjg5YzNiOWEzYzI5NWExZjEzMyIsIm5iZiI6MTc4NjYxNjA3MS45OTUwMDAxLCJzdWIiOiI2YTdkOTkwNzFiNmQ5ZjIzM2ZjODkzNzkiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.78O8ELoZa7jOxxr46ta_DGay39OzjvEjBfT0VwJdbWM'
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185'

export interface TMDBSuggestion {
  id: number
  mediaType: 'show' | 'movie'
  title: string
  year?: number
  posterPath?: string
}

export interface TMDBExternalFindResult {
  title: string
  mediaType: 'show' | 'movie'
  tmdbId: number
  posterPath?: string
  totalSeasons?: number
  runtimeMinutes?: number
  releaseYear?: number
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
export const getTMDBDetails = async (id: number, mediaType: 'show' | 'movie') => {
  const endpoint = mediaType === 'show' ? `/tv/${id}` : `/movie/${id}`
  const res = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
    headers: defaultHeaders
  })

  if (!res.ok) return null
  return res.json()
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

      return {
        title: show.name || show.original_name,
        mediaType: 'show',
        tmdbId: show.id,
        posterPath: show.poster_path
          ? `${TMDB_IMAGE_BASE_URL}${show.poster_path}`
          : undefined,
        totalSeasons: details?.number_of_seasons,
        releaseYear: show.first_air_date
          ? new Date(show.first_air_date).getFullYear()
          : undefined
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