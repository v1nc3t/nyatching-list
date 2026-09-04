export interface TMDBEpisodeRef {
  air_date?: string
  episode_number?: number
  season_number?: number
  name?: string
}

export interface TMDBAiredEpisode {
  season: number
  episode: number
}

export interface TMDBAiredDetails {
  last_episode_to_air?: TMDBEpisodeRef | null
  next_episode_to_air?: TMDBEpisodeRef | null
}

export const todayLocalIsoDate = (date: Date = new Date()): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const toAiredEpisode = (ep?: TMDBEpisodeRef | null): TMDBAiredEpisode | null => {
  if (!ep) return null
  if (typeof ep.season_number !== 'number' || ep.season_number < 1) return null
  if (typeof ep.episode_number !== 'number' || ep.episode_number < 1) return null
  return { season: ep.season_number, episode: ep.episode_number }
}

export const compareAiredEpisodes = (a: TMDBAiredEpisode, b: TMDBAiredEpisode): number => {
  if (a.season !== b.season) return a.season - b.season
  return a.episode - b.episode
}

export const isAiredAheadOfProgress = (
  aired: TMDBAiredEpisode,
  currentSeason: number,
  currentEpisode: number
): boolean => compareAiredEpisodes(aired, { season: currentSeason, episode: currentEpisode }) > 0

/** Last released episode number in a season, for progress max. */
export const airedEpisodeCountForSeason = (
  latest: TMDBAiredEpisode | null,
  seasonNumber: number,
  seasonEpisodeCount?: number
): number | undefined => {
  if (!latest) return undefined
  if (latest.season > seasonNumber) {
    return seasonEpisodeCount && seasonEpisodeCount > 0 ? seasonEpisodeCount : undefined
  }
  if (latest.season === seasonNumber) {
    return latest.episode
  }
  return undefined
}

/**
 * Latest episode that has actually aired, using last_episode_to_air and
 * next_episode_to_air when its air date is today or earlier. Skips specials.
 */
export const getLatestAiredEpisode = (
  details: TMDBAiredDetails | null,
  today: string = todayLocalIsoDate()
): TMDBAiredEpisode | null => {
  if (!details) return null

  const last = toAiredEpisode(details.last_episode_to_air)
  const next = toAiredEpisode(details.next_episode_to_air)
  const nextAirDate = details.next_episode_to_air?.air_date
  const nextHasAired = Boolean(next && nextAirDate && nextAirDate <= today)

  let latest = last
  if (next && nextHasAired && (!latest || compareAiredEpisodes(next, latest) > 0)) {
    latest = next
  }

  return latest
}

export const getLatestAiredFromEpisodeList = (
  episodes: TMDBEpisodeRef[],
  today: string = todayLocalIsoDate()
): TMDBAiredEpisode | null => {
  let latest: TMDBAiredEpisode | null = null

  for (const ep of episodes) {
    if (!ep.air_date || ep.air_date > today) continue
    const aired = toAiredEpisode(ep)
    if (!aired) continue
    if (!latest || compareAiredEpisodes(aired, latest) > 0) {
      latest = aired
    }
  }

  return latest
}
