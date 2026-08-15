export type MediaStatus = 'watching' | 'waiting' | 'completed' | 'dropped';

export interface AppSettings {
  newSeasonCheckIntervalHours: number // -1 means Never
  stallReminderDays: number // -1 means Never
  enableSystemNotifications?: boolean // Optional / Deprecated
}

export interface BaseMedia {
  id: string;
  title: string;
  mediaType: 'show' | 'movie';
  status: MediaStatus;
  watchingUrl: string;
  posterPath?: string;
  tmdbId?: number;
  createdAt: number;
  updatedAt: number;
  lastProgressUpdate: number      // Updated whenever episode or minutes change
  lastStallNotified?: number      // Prevents repeated notification spam
  /** When true, remind if progress (episodes/minutes) is not updated */
  notifyEnabled?: boolean;
}

export interface Show extends BaseMedia {
  mediaType: 'show';
  currentSeason: number;
  currentEpisode: number;
  totalSeasons?: number;
  /** When true, background checks TMDB for new seasons */
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