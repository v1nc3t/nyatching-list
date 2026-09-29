export type MediaStatus = 'watching' | 'waiting' | 'next' | 'completed' | 'dropped';

export interface AppSettings {
  newSeasonCheckIntervalHours: number // -1 means Never
  reminderIntervalHours: number // -1 means Never
  lastReleaseCheckAt?: number
  lastReminderCheckAt?: number
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
  /** When false, release alerts and watching reminders stay off. Missing means on. */
  notify?: boolean
  /** Progress or status change. Reminder clock. */
  lastActivityAt?: number
  /** Last watching reminder sent for this item. */
  lastRemindedAt?: number
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
  /** Next up only. True after a check saw no aired episodes. False if it was already airing. */
  awaitingRelease?: boolean;
  /** When the last new-episode alert for this show was sent. */
  lastReleaseNotifiedAt?: number;
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