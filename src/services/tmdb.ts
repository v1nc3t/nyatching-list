// src/services/tmdb.ts

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

export const searchTMDB = async (query: string): Promise<TMDBSuggestion[]> => {
  if (!query.trim() || query.length < 2) return []

  try {
    const res = await fetch(
      `${TMDB_BASE_URL}/search/multi?query=${encodeURIComponent(query)}&include_adult=false`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_READ_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!res.ok) return []

    const data = await res.json()

    return data.results
      .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 5) // Limit to 5 live options
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

// Fetch details to auto-fill metadata like seasons or movie runtime
export const getTMDBDetails = async (id: number, mediaType: 'show' | 'movie') => {
  const endpoint = mediaType === 'show' ? `/tv/${id}` : `/movie/${id}`
  const res = await fetch(`${TMDB_BASE_URL}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${TMDB_READ_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) return null
  return res.json()
}