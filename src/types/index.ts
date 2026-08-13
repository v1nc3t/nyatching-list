export type MediaStatus = 'watching' | 'waiting' | 'completed' | 'dropped';

export interface BaseMedia {
  id: string;
  title: string;
  mediaType: 'show' | 'movie';
  status: MediaStatus;
  watchingUrl: string;
  posterPath?: string;
  tmdbId?: number;
  updatedAt: number;
}

export interface Show extends BaseMedia {
  mediaType: 'show';
  currentSeason: number;
  currentEpisode: number;
  totalSeasons?: number;
  tracked?: boolean;
}

export interface Movie extends BaseMedia {
  mediaType: 'movie';
  currentMinutes: number;
  runtimeMinutes?: number;
  releaseYear?: number;
}

export type TrackedMedia = Show | Movie;

export function isShow(media: TrackedMedia): media is Show {
  return media.mediaType === 'show';
}

export function isMovie(media: TrackedMedia): media is Movie {
  return media.mediaType === 'movie';
}

export interface NotificationItem {
  id: string
  showId: string
  title: string
  message: string
  posterPath?: string
  timestamp: number
  read: boolean
}