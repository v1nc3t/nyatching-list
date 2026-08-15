import browser from 'webextension-polyfill';
import {
  TrackedMedia,
  Show,
  Movie,
  MediaStatus,
  isShow,
  isMovie,
  NotificationItem,
  AppSettings,
} from '../types';

export interface StorageSchema {
  nyatching_list_media: TrackedMedia[];
  nyatching_notification_log: NotificationItem[];
  nyatching_settings: AppSettings;
}

const STORAGE_KEY = 'nyatching_list_media' as const;
const NOTIFICATIONS_STORAGE_KEY = 'nyatching_notification_log' as const;
const SETTINGS_STORAGE_KEY = 'nyatching_settings' as const;

const VALID_STATUSES: MediaStatus[] = ['watching', 'waiting', 'completed', 'dropped'];

export const TIME_INTERVAL_OPTIONS = [
  { label: 'Never', hours: -1, days: -1 },
  { label: '1 Day', hours: 24, days: 1 },
  { label: '2 Days', hours: 48, days: 2 },
  { label: '1 Week', hours: 168, days: 7 },
  { label: '2 Weeks', hours: 336, days: 14 },
  { label: '1 Month', hours: 720, days: 30 },
  { label: '2 Months', hours: 1440, days: 60 },
  { label: '6 Months', hours: 4320, days: 180 },
  { label: '1 Year', hours: 8760, days: 365 },
] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  newSeasonCheckIntervalHours: 24,
  stallReminderDays: 7,
};

// ==========================================
// UTILITY & LOW-LEVEL STORAGE OPERATIONS
// ==========================================

function isStorageAvailable(): boolean {
  return typeof browser !== 'undefined' && Boolean(browser.storage?.local);
}

function generateFallbackId(title: string): string {
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `manual-${cleanTitle}-${Date.now()}`;
}

async function setStorageData(data: Record<string, unknown>): Promise<void> {
  if (!isStorageAvailable()) return;
  try {
    await browser.storage.local.set(data);
  } catch (error) {
    console.error('[Nyatching List] Storage set failed:', error);
    throw error;
  }
}

// ==========================================
// SETTINGS OPERATIONS
// ==========================================

export const getSettings = async (): Promise<AppSettings> => {
  if (!isStorageAvailable()) return DEFAULT_SETTINGS;
  const result = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_STORAGE_KEY] as AppSettings) };
};

export const saveSettings = async (settings: Partial<AppSettings>): Promise<AppSettings> => {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await setStorageData({ [SETTINGS_STORAGE_KEY]: updated });
  return updated;
};

// ==========================================
// READ MEDIA OPERATIONS
// ==========================================

export async function getAllMedia(): Promise<TrackedMedia[]> {
  if (!isStorageAvailable()) return [];
  const data = await browser.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as TrackedMedia[]) ?? [];
}

export async function getShows(): Promise<Show[]> {
  const media = await getAllMedia();
  return media.filter(isShow);
}

export async function getMovies(): Promise<Movie[]> {
  const media = await getAllMedia();
  return media.filter(isMovie);
}

export async function getMediaById(id: string): Promise<TrackedMedia | undefined> {
  const media = await getAllMedia();
  return media.find((item) => item.id === id);
}

export async function saveMedia(item: TrackedMedia): Promise<void> {
  if (!isStorageAvailable()) return;

  const mediaList = await getAllMedia();
  const existingIndex = mediaList.findIndex((existing) => existing.id === item.id);

  const updatedItem: TrackedMedia = {
    ...item,
    updatedAt: Date.now(),
  };

  if (existingIndex >= 0) {
    mediaList[existingIndex] = updatedItem;
  } else {
    mediaList.push(updatedItem);
  }

  await setStorageData({ [STORAGE_KEY]: mediaList });
}

// ==========================================
// QUERY HELPER
// ==========================================

export interface MediaQueryOptions {
  status?: MediaStatus;
  mediaType?: 'show' | 'movie';
  searchTerm?: string;
  sortBy?: 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

export async function queryMedia(options: MediaQueryOptions = {}): Promise<TrackedMedia[]> {
  let list = await getAllMedia();

  if (options.mediaType) {
    list = list.filter((item) => item.mediaType === options.mediaType);
  }

  if (options.status) {
    list = list.filter((item) => item.status === options.status);
  }

  if (options.searchTerm && options.searchTerm.trim() !== '') {
    const term = options.searchTerm.toLowerCase().trim();
    list = list.filter((item) => item.title.toLowerCase().includes(term));
  }

  const sortBy = options.sortBy ?? 'updatedAt';
  const sortOrder = options.sortOrder ?? 'desc';

  return list.sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'updatedAt') {
      comparison = a.updatedAt - b.updatedAt;
    } else if (sortBy === 'title') {
      comparison = a.title.localeCompare(b.title);
    }
    return sortOrder === 'desc' ? -comparison : comparison;
  });
}

// ==========================================
// HIGH-LEVEL WRITE ACTIONS
// ==========================================

export type AddMediaInput =
  | ({ mediaType: 'show'; currentSeason: number; currentEpisode: number; totalSeasons?: number } & BaseAddInput)
  | ({ mediaType: 'movie'; currentMinutes: number; runtimeMinutes?: number; releaseYear?: number } & BaseAddInput);

interface BaseAddInput {
  id?: string;
  title: string;
  status?: MediaStatus;
  watchingUrl?: string;
  posterPath?: string;
  tmdbId?: number;
}

export async function addMedia(input: AddMediaInput): Promise<TrackedMedia> {
  if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
    throw new Error('[Nyatching List] Valid title is required.');
  }

  const trimmedTitle = input.title.trim();
  const existingMedia = await getAllMedia();

  const isDuplicate = existingMedia.some((item) => {
    if (input.tmdbId && item.tmdbId && item.tmdbId === input.tmdbId && item.mediaType === input.mediaType) {
      return true;
    }
    return item.title.toLowerCase() === trimmedTitle.toLowerCase();
  });

  if (isDuplicate) {
    throw new Error(`[Nyatching List] "${trimmedTitle}" is already in your list.`);
  }

  let finalId = input.id?.trim();
  if (!finalId) {
    if (input.tmdbId) {
      finalId = `tmdb-${input.mediaType}-${input.tmdbId}`;
    } else {
      finalId = generateFallbackId(trimmedTitle);
    }
  }

  const status: MediaStatus = input.status ?? 'watching';
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`[Nyatching List] Invalid status "${status}".`);
  }

  const now = Date.now();
  const baseData = {
    id: finalId,
    title: trimmedTitle,
    status,
    watchingUrl: input.watchingUrl?.trim() || '',
    posterPath: input.posterPath?.trim() || undefined,
    tmdbId: input.tmdbId,
    createdAt: now,
    updatedAt: now,
    lastProgressUpdate: now,
  };

  let newItem: TrackedMedia;

  if (input.mediaType === 'show') {
    newItem = {
      ...baseData,
      mediaType: 'show',
      currentSeason: input.currentSeason ?? 1,
      currentEpisode: input.currentEpisode ?? 1,
      totalSeasons: input.totalSeasons,
      tracked: false,
      notifyEnabled: false,
    };
  } else {
    newItem = {
      ...baseData,
      mediaType: 'movie',
      currentMinutes: input.currentMinutes ?? 0,
      runtimeMinutes: input.runtimeMinutes,
      releaseYear: input.releaseYear,
      notifyEnabled: false,
    };
  }

  await saveMedia(newItem);
  return newItem;
}

export type UpdateMediaInput = { id: string } & (
  | Partial<Omit<Show, 'id' | 'mediaType' | 'updatedAt'>>
  | Partial<Omit<Movie, 'id' | 'mediaType' | 'updatedAt'>>
);

export async function updateMedia(input: UpdateMediaInput): Promise<TrackedMedia> {
  const { id, ...updates } = input;

  if (!id || typeof id !== 'string' || id.trim() === '') {
    throw new Error('[Nyatching List] A valid item ID is required for updates.');
  }

  const existingItem = await getMediaById(id);
  if (!existingItem) {
    throw new Error(`[Nyatching List] Item with ID "${id}" was not found.`);
  }

  if (updates.status !== undefined && !VALID_STATUSES.includes(updates.status)) {
    throw new Error(`[Nyatching List] Invalid status "${updates.status}".`);
  }

  const now = Date.now();
  let progressChanged = false;

  if (isShow(existingItem)) {
    const showUpdates = updates as Partial<Show>;
    const season = showUpdates.currentSeason ?? existingItem.currentSeason;
    const episode = showUpdates.currentEpisode ?? existingItem.currentEpisode;

    if (showUpdates.currentSeason !== undefined && (!Number.isInteger(season) || season < 1)) {
      throw new Error('[Nyatching List] Season must be an integer >= 1.');
    }
    if (showUpdates.currentEpisode !== undefined && (!Number.isInteger(episode) || episode < 1)) {
      throw new Error('[Nyatching List] Episode must be an integer >= 1.');
    }

    if (
      (showUpdates.currentSeason !== undefined && showUpdates.currentSeason !== existingItem.currentSeason) ||
      (showUpdates.currentEpisode !== undefined && showUpdates.currentEpisode !== existingItem.currentEpisode)
    ) {
      progressChanged = true;
    }

    const updatedShow: Show = {
      ...existingItem,
      ...showUpdates,
      currentSeason: season,
      currentEpisode: episode,
      updatedAt: now,
      lastProgressUpdate: progressChanged
        ? now
        : existingItem.lastProgressUpdate || existingItem.createdAt || now,
    };

    await saveMedia(updatedShow);
    return updatedShow;
  }

  if (isMovie(existingItem)) {
    const movieUpdates = updates as Partial<Movie>;
    const minutes = movieUpdates.currentMinutes ?? existingItem.currentMinutes;

    if (movieUpdates.currentMinutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) {
      throw new Error('[Nyatching List] Current minutes must be a non-negative integer.');
    }

    if (movieUpdates.currentMinutes !== undefined && movieUpdates.currentMinutes !== existingItem.currentMinutes) {
      progressChanged = true;
    }

    const updatedMovie: Movie = {
      ...existingItem,
      ...movieUpdates,
      currentMinutes: minutes,
      updatedAt: now,
      lastProgressUpdate: progressChanged
        ? now
        : existingItem.lastProgressUpdate || existingItem.createdAt || now,
    };

    await saveMedia(updatedMovie);
    return updatedMovie;
  }

  throw new Error('[Nyatching List] Unsupported media type.');
}

// ==========================================
// DELETE & CLEAR OPERATIONS
// ==========================================

export async function deleteMedia(id: string): Promise<void> {
  if (!isStorageAvailable()) return;
  const mediaList = await getAllMedia();
  const filteredList = mediaList.filter((item) => item.id !== id);
  await setStorageData({ [STORAGE_KEY]: filteredList });
}

export async function clearAllMedia(): Promise<void> {
  if (!isStorageAvailable()) return;
  await browser.storage.local.remove(STORAGE_KEY);
}

// ==========================================
// NOTIFICATION LOG STORAGE HELPERS
// ==========================================

export async function getNotificationLog(): Promise<NotificationItem[]> {
  if (!isStorageAvailable()) return [];
  const data = await browser.storage.local.get(NOTIFICATIONS_STORAGE_KEY);
  return (data[NOTIFICATIONS_STORAGE_KEY] as NotificationItem[]) ?? [];
}

export async function addNotificationLog(
  item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>
): Promise<NotificationItem[]> {
  const current = await getNotificationLog();
  const newItem: NotificationItem = {
    ...item,
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    read: false,
  };

  const updated = [newItem, ...current];
  await setStorageData({ [NOTIFICATIONS_STORAGE_KEY]: updated });
  return updated;
}

export async function deleteNotificationLogItem(id: string): Promise<NotificationItem[]> {
  const current = await getNotificationLog();
  const updated = current.filter((n) => n.id !== id);
  await setStorageData({ [NOTIFICATIONS_STORAGE_KEY]: updated });
  return updated;
}

export async function clearAllNotificationLogs(): Promise<void> {
  if (!isStorageAvailable()) return;
  await browser.storage.local.remove(NOTIFICATIONS_STORAGE_KEY);
}

// ==========================================
// REACTIVE STORAGE LISTENER
// ==========================================

export function onMediaStorageChange(
  callback: (newMedia: TrackedMedia[]) => void
): () => void {
  if (!isStorageAvailable()) return () => {};

  const listener = (
    changes: { [key: string]: browser.Storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      callback((changes[STORAGE_KEY].newValue as TrackedMedia[]) ?? []);
    }
  };

  browser.storage.onChanged.addListener(listener);

  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}