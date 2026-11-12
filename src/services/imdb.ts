import type { MediaStatus, TrackedMedia } from '../types'
import { completedProgressFromShowInfo, type TMDBExternalFindResult } from './tmdb'

/** One title from an IMDb CSV export. */
export interface ImdbRow {
  imdbId: string
  title: string
  mediaType: 'show' | 'movie'
  year?: number
  runtimeMinutes?: number
}

const SHOW_TYPES = ['TV Series', 'TV Mini Series']
// Single episodes, games and podcasts are not titles the list tracks
const SKIP_TYPES = ['TV Episode', 'Video Game', 'Podcast Series', 'Podcast Episode']

/** Splits CSV text into rows of fields. Quoted fields may hold commas, quotes ("") and line breaks. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Reads an IMDb ratings export. Skipped counts rows that are episodes, games or broken. */
export const parseImdbRatings = (text: string): { rows: ImdbRow[]; skipped: number } => {
  const [header = [], ...lines] = parseCsv(text.replace(/^﻿/, ''))
  const col = (name: string) => header.indexOf(name)
  const [iConst, iTitle, iType, iYear, iRuntime] = ['Const', 'Title', 'Title Type', 'Year', 'Runtime (mins)'].map(col)
  if (iConst < 0 || iTitle < 0 || iType < 0) throw new Error('This is not an IMDb ratings file.')

  const rows: ImdbRow[] = []
  let skipped = 0
  for (const f of lines) {
    const imdbId = f[iConst]?.trim()
    if (!imdbId) continue
    const title = f[iTitle]?.trim()
    // The id goes into a TMDB URL, so only accept the tt1234 shape
    if (!/^tt\d+$/.test(imdbId) || !title || SKIP_TYPES.includes(f[iType])) {
      skipped++
      continue
    }
    const num = (i: number) => {
      const n = Number(f[i])
      return n > 0 ? n : undefined
    }
    rows.push({
      imdbId,
      title,
      mediaType: SHOW_TYPES.includes(f[iType]) ? 'show' : 'movie',
      year: num(iYear),
      runtimeMinutes: num(iRuntime),
    })
  }
  if (!rows.length) throw new Error('This file has no movies or shows to import.')
  return { rows, skipped }
}

/** A new list title with progress that fits its status, like adding one from the popup. */
export const imdbToMedia = (
  row: ImdbRow,
  tmdb: TMDBExternalFindResult | null,
  status: MediaStatus,
  now: number = Date.now()
): TrackedMedia => {
  const base = {
    id: tmdb ? `tmdb-${row.mediaType}-${tmdb.tmdbId}` : `imdb-${row.imdbId}`,
    title: row.title,
    status,
    watchingUrl: '',
    posterPath: tmdb?.posterPath,
    tmdbId: tmdb?.tmdbId,
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  }

  if (row.mediaType === 'movie') {
    const runtime = row.runtimeMinutes ?? tmdb?.runtimeMinutes
    return {
      ...base,
      mediaType: 'movie',
      currentMinutes: status === 'completed' && runtime ? runtime : 0,
      runtimeMinutes: runtime,
      releaseYear: row.year ?? tmdb?.releaseYear,
    }
  }

  const info = tmdb?.showInfo
  // Completed and waiting sit at the latest aired episode; the rest start at the beginning
  const atLatest = info && (status === 'completed' || (status === 'waiting' && info.latestAired))
  const progress = atLatest ? completedProgressFromShowInfo(info) : null
  const start = status === 'next' ? 0 : 1
  return {
    ...base,
    mediaType: 'show',
    currentSeason: progress?.currentSeason ?? start,
    currentEpisode: progress?.currentEpisode ?? start,
    totalSeasons: progress?.totalSeasons ?? info?.totalSeasons ?? tmdb?.totalSeasons,
    totalEpisodes: progress?.totalEpisodes,
    notify: true,
  }
}

const selfCheckImdb = (): void => {
  const csv =
    '﻿Const,Your Rating,Title,Title Type,Runtime (mins),Year\r\n' +
    'tt1,8,"Dune, Part ""Two""",Movie,166,2024\r\n' +
    'tt2,9,Severance,TV Series,55,2022\n' +
    'tt3,7,An Episode,TV Episode,40,2020\n' +
    'bad,7,Broken,Movie,90,2020\n' +
    '\n'
  const { rows, skipped } = parseImdbRatings(csv)
  if (rows.length !== 2 || skipped !== 2) throw new Error('imdb: keeps movies and shows, skips the rest')
  if (rows[0].title !== 'Dune, Part "Two"' || rows[0].runtimeMinutes !== 166) {
    throw new Error('imdb: reads quoted fields')
  }
  if (rows[1].mediaType !== 'show' || rows[1].year !== 2022) throw new Error('imdb: TV Series is a show')

  const movie = imdbToMedia(rows[0], null, 'completed', 1)
  if (movie.mediaType !== 'movie' || movie.currentMinutes !== 166 || movie.id !== 'imdb-tt1') {
    throw new Error('imdb: completed movie is watched to the end')
  }
  const info = {
    totalSeasons: 3,
    seasons: [],
    lastSeason: { seasonNumber: 2, episodeCount: 9 },
    latestAired: { season: 2, episode: 9 },
    ended: false,
  }
  const tmdb = { title: 'Severance', mediaType: 'show' as const, tmdbId: 5, showInfo: info }
  const done = imdbToMedia(rows[1], tmdb, 'completed', 1)
  if (done.mediaType !== 'show' || done.currentSeason !== 2 || done.currentEpisode !== 9) {
    throw new Error('imdb: completed show sits at the latest aired episode')
  }
  const next = imdbToMedia(rows[1], tmdb, 'next', 1)
  if (next.mediaType !== 'show' || next.currentSeason !== 0 || next.id !== 'tmdb-show-5') {
    throw new Error('imdb: next up show has not started')
  }
}

selfCheckImdb()
