export type MediaStatus = 'watching' | 'waiting' | 'completed' | 'dropped';

export interface AppSettings {
  newSeasonCheckIntervalHours: number // -1 means Never
  stallReminderDays: number // -1 means Never
  lastReleaseCheckAt?: number
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
  lastStallNotified?: number
  /** When false, this item never sends notifications. Missing means on. */
  notify?: boolean
}

export interface Show extends BaseMedia {
  mediaType: 'show';
  currentSeason: number;
  currentEpisode: number;
  totalSeasons?: number;
  /** Last released episode of the current season (progress max) */
  totalEpisodes?: number;
  lastNotifiedSeason?: number;
  lastNotifiedEpisode?: number;
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

export function isNotifyEnabled(media: TrackedMedia): boolean {
  return media.notify !== false;
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
  watchingUrl?: string
  timestamp: number
  read: boolean
}