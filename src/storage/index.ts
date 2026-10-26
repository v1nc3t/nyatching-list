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

const STORAGE_KEY = 'nyatching_list_media' as const;
const NOTIFICATIONS_STORAGE_KEY = 'nyatching_notification_log' as const;
const SETTINGS_STORAGE_KEY = 'nyatching_settings' as const;
const VALID_STATUSES: MediaStatus[] = ['watching', 'waiting', 'next', 'completed', 'dropped'];
const ACTIVITY_KEYS = ['status', 'currentSeason', 'currentEpisode', 'currentMinutes'] as const;

function resolveActivityAt(
  existing: TrackedMedia,
  updates: Record<string, unknown>,
  now: number
): number {
  if (ACTIVITY_KEYS.some((key) => updates[key] !== undefined)) return now;
  if (typeof updates.lastActivityAt === 'number') return updates.lastActivityAt;
  return existing.lastActivityAt ?? existing.updatedAt;
}

export const DEFAULT_SETTINGS: AppSettings = {
  newSeasonCheckIntervalHours: 24,
  reminderIntervalHours: 168,
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
  const stored = (result[SETTINGS_STORAGE_KEY] ?? {}) as Record<string, unknown>;
  const { stallReminderDays: _removed, ...rest } = stored;
  return { ...DEFAULT_SETTINGS, ...rest } as AppSettings;
};

export const saveSettings = async (settings: Partial<AppSettings>): Promise<AppSettings> => {
  const current = await getSettings();
  const updated: AppSettings = {
    newSeasonCheckIntervalHours:
      settings.newSeasonCheckIntervalHours ?? current.newSeasonCheckIntervalHours,
    reminderIntervalHours: settings.reminderIntervalHours ?? current.reminderIntervalHours,
    lastReleaseCheckAt: settings.lastReleaseCheckAt ?? current.lastReleaseCheckAt,
    lastReminderCheckAt: settings.lastReminderCheckAt ?? current.lastReminderCheckAt,
  };
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
// HIGH-LEVEL WRITE ACTIONS
// ==========================================

export type AddMediaInput =
  | ({ mediaType: 'show'; currentSeason: number; currentEpisode: number; totalSeasons?: number; totalEpisodes?: number } & BaseAddInput)
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
    lastActivityAt: now,
  };

  let newItem: TrackedMedia;

  if (input.mediaType === 'show') {
    const season = status === 'next' ? 0 : input.currentSeason ?? 1;
    const episode = status === 'next' ? 0 : input.currentEpisode ?? 1;
    if (status !== 'next' && (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1)) {
      throw new Error('[Nyatching List] Season and episode must be integers >= 1.');
    }
    newItem = {
      ...baseData,
      mediaType: 'show',
      currentSeason: season,
      currentEpisode: episode,
      totalSeasons: input.totalSeasons,
      totalEpisodes: input.totalEpisodes,
      notify: true,
    };
  } else {
    newItem = {
      ...baseData,
      mediaType: 'movie',
      currentMinutes: status === 'next' ? 0 : input.currentMinutes ?? 0,
      runtimeMinutes: input.runtimeMinutes,
      releaseYear: input.releaseYear,
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

  if (isShow(existingItem)) {
    const showUpdates = updates as Partial<Show>;
    const nextStatus = showUpdates.status ?? existingItem.status;
    let season = showUpdates.currentSeason ?? existingItem.currentSeason;
    let episode = showUpdates.currentEpisode ?? existingItem.currentEpisode;
    if (nextStatus === 'next') {
      season = 0;
      episode = 0;
    }

    if (nextStatus !== 'next') {
      if (showUpdates.currentSeason !== undefined && (!Number.isInteger(season) || season < 1)) {
        throw new Error('[Nyatching List] Season must be an integer >= 1.');
      }
      if (showUpdates.currentEpisode !== undefined && (!Number.isInteger(episode) || episode < 1)) {
        throw new Error('[Nyatching List] Episode must be an integer >= 1.');
      }
    }

    const updatedShow: Show = {
      ...existingItem,
      ...showUpdates,
      currentSeason: season,
      currentEpisode: episode,
      updatedAt: now,
      lastActivityAt: resolveActivityAt(existingItem, showUpdates, now),
    };

    await saveMedia(updatedShow);
    return updatedShow;
  }

  if (isMovie(existingItem)) {
    const movieUpdates = updates as Partial<Movie>;
    const nextStatus = movieUpdates.status ?? existingItem.status;
    let minutes = movieUpdates.currentMinutes ?? existingItem.currentMinutes;
    if (nextStatus === 'next') minutes = 0;

    if (movieUpdates.currentMinutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) {
      throw new Error('[Nyatching List] Current minutes must be a non-negative integer.');
    }

    const updatedMovie: Movie = {
      ...existingItem,
      ...movieUpdates,
      currentMinutes: minutes,
      updatedAt: now,
      lastActivityAt: resolveActivityAt(existingItem, movieUpdates, now),
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

// ==========================================
// BACKUP (EXPORT / IMPORT)
// ==========================================

export const THEME_STORAGE_KEY = 'nyatching_theme' as const;
const BACKUP_FORMAT = 'nyatching-list-backup' as const;

type Theme = 'light' | 'dark';

export interface BackupSettings {
  newSeasonCheckIntervalHours: number;
  reminderIntervalHours: number;
  theme?: Theme;
}

/** Every part is optional: a file holds only what was picked on export. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  media?: TrackedMedia[];
  settings?: BackupSettings;
  notifications?: NotificationItem[];
}

export type StatusMode = 'all' | 'only' | 'except';

export type MediaFieldGroup = 'progress' | 'watchLink' | 'poster' | 'tmdb' | 'notify' | 'alertHistory';

/** Field groups a user can leave out of exported titles. Core fields (id, title, mediaType, status, createdAt, updatedAt) are always kept. */
export const MEDIA_FIELD_GROUPS: { key: MediaFieldGroup; label: string; hint: string; fields: string[] }[] = [
  { key: 'progress', label: 'Progress', hint: 'season, episode, minutes', fields: ['currentSeason', 'currentEpisode', 'currentMinutes'] },
  { key: 'watchLink', label: 'Watch link', hint: 'where you watch it', fields: ['watchingUrl'] },
  { key: 'poster', label: 'Poster', hint: 'poster image path', fields: ['posterPath'] },
  { key: 'tmdb', label: 'TMDB details', hint: 'TMDB id, season and episode counts, runtime, year', fields: ['tmdbId', 'totalSeasons', 'totalEpisodes', 'runtimeMinutes', 'releaseYear'] },
  { key: 'notify', label: 'Notify setting', hint: 'per-title notify on or off', fields: ['notify'] },
  { key: 'alertHistory', label: 'Alert history', hint: 'when reminders and release alerts last ran', fields: ['lastActivityAt', 'lastRemindedAt', 'lastNotifiedSeason', 'lastNotifiedEpisode', 'awaitingRelease', 'lastReleaseNotifiedAt'] },
];

export interface MediaFilter {
  types: TrackedMedia['mediaType'][];
  statusMode: StatusMode;
  /** Used when statusMode is 'only' (keep these) or 'except' (drop these). Ignored for 'all'. */
  statuses: MediaStatus[];
  /** Field groups left out of each title. Empty = all fields. */
  excludeFields: MediaFieldGroup[];
}

export interface ExportChoice {
  /** null leaves titles out of the file. */
  media: MediaFilter | null;
  settings: boolean;
  notifications: boolean;
}

export interface ImportChoice {
  media: boolean;
  settings: boolean;
  notifications: boolean;
}

export interface ImportResult {
  media?: { added: number; updated: number; skipped: number };
  settings?: AppSettings;
  notificationsAdded?: number;
}

export const matchesMediaFilter = (item: TrackedMedia, filter: MediaFilter): boolean => {
  if (!filter.types.includes(item.mediaType)) return false;
  if (filter.statusMode === 'all') return true;
  const listed = filter.statuses.includes(item.status);
  return filter.statusMode === 'only' ? listed : !listed;
};

const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

export async function exportBackup(choice: ExportChoice): Promise<Backup> {
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
  };

  if (choice.media) {
    const filter = choice.media;
    const dropped = MEDIA_FIELD_GROUPS.filter((g) => filter.excludeFields.includes(g.key)).flatMap(
      (g) => g.fields
    );
    backup.media = (await getAllMedia())
      .filter((item) => matchesMediaFilter(item, filter))
      .map((item) => {
        const copy: Record<string, unknown> = { ...item };
        for (const key of dropped) delete copy[key];
        return copy as unknown as TrackedMedia;
      });
  }
  if (choice.settings) {
    const { newSeasonCheckIntervalHours, reminderIntervalHours } = await getSettings();
    const theme = isStorageAvailable()
      ? (await browser.storage.local.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY]
      : undefined;
    backup.settings = {
      newSeasonCheckIntervalHours,
      reminderIntervalHours,
      ...(isTheme(theme) ? { theme } : {}),
    };
  }
  if (choice.notifications) {
    backup.notifications = await getNotificationLog();
  }
  return backup;
}

/** A title from a file: progress and the watch link may be missing. */
type ImportedMedia = Partial<TrackedMedia> &
  Pick<TrackedMedia, 'id' | 'title' | 'mediaType' | 'status' | 'createdAt' | 'updatedAt'>;

function isValidMedia(item: unknown): item is ImportedMedia {
  const m = item as Record<string, unknown> | null;
  if (!m || typeof m.id !== 'string' || !m.id) return false;
  if (typeof m.title !== 'string' || !m.title.trim()) return false;
  if (typeof m.createdAt !== 'number' || typeof m.updatedAt !== 'number') return false;
  if (!VALID_STATUSES.includes(m.status as MediaStatus)) return false;
  if (m.mediaType === 'show') {
    return [m.currentSeason, m.currentEpisode].every((v) => v === undefined || Number.isInteger(v));
  }
  if (m.mediaType === 'movie') {
    return m.currentMinutes === undefined || (typeof m.currentMinutes === 'number' && m.currentMinutes >= 0);
  }
  return false;
}

/** Fills what a file left out so a new title is complete. */
function withDefaults(item: ImportedMedia): TrackedMedia {
  const base = { watchingUrl: '', ...item };
  if (item.mediaType === 'movie') return { currentMinutes: 0, ...base } as Movie;
  const start = item.status === 'next' ? 0 : 1;
  return { currentSeason: start, currentEpisode: start, ...base } as Show;
}

// Same title added twice through TMDB gets the same key even if the ids differ.
const mediaKey = (m: Pick<TrackedMedia, 'id' | 'mediaType' | 'tmdbId'>): string =>
  m.tmdbId ? `${m.mediaType}:${m.tmdbId}` : m.id;

/** Never removes titles; when a title is in both, the newer copy wins field by field (fields missing from the file keep their value). */
async function mergeMedia(items: unknown[]): Promise<NonNullable<ImportResult['media']>> {
  const list = await getAllMedia();
  const indexByKey = new Map(list.map((m, i) => [mediaKey(m), i]));
  // A file exported without TMDB details has no tmdbId, so also match on id.
  const indexById = new Map(list.map((m, i) => [m.id, i]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    if (!isValidMedia(item)) {
      skipped++;
      continue;
    }
    const i = indexByKey.get(mediaKey(item)) ?? indexById.get(item.id);
    if (i === undefined) {
      indexByKey.set(mediaKey(item), list.length);
      indexById.set(item.id, list.length);
      list.push(withDefaults(item));
      added++;
    } else if (item.updatedAt > list[i].updatedAt) {
      list[i] = { ...list[i], ...item } as TrackedMedia;
      updated++;
    }
  }

  if (added || updated) await setStorageData({ [STORAGE_KEY]: list });
  return { added, updated, skipped };
}

const isValidInterval = (value: unknown): value is number =>
  typeof value === 'number' && (value === -1 || value > 0);

function isValidNotification(item: unknown): item is NotificationItem {
  const n = item as Record<string, unknown> | null;
  return (
    !!n &&
    typeof n.id === 'string' &&
    typeof n.showId === 'string' &&
    typeof n.title === 'string' &&
    typeof n.message === 'string' &&
    typeof n.timestamp === 'number' &&
    typeof n.read === 'boolean'
  );
}

/** Adds entries not already in the log, newest first. */
async function mergeNotifications(items: unknown[]): Promise<number> {
  const current = await getNotificationLog();
  const ids = new Set(current.map((n) => n.id));
  const added: NotificationItem[] = [];
  for (const item of items) {
    if (isValidNotification(item) && !ids.has(item.id)) {
      ids.add(item.id);
      added.push(item);
    }
  }
  if (added.length) {
    const merged = [...current, ...added].sort((a, b) => b.timestamp - a.timestamp);
    await setStorageData({ [NOTIFICATIONS_STORAGE_KEY]: merged });
  }
  return added.length;
}

const isValidSettings = (s: BackupSettings | undefined): s is BackupSettings =>
  !!s && isValidInterval(s.newSeasonCheckIntervalHours) && isValidInterval(s.reminderIntervalHours);

/** Parses and checks a backup file. */
export function parseBackup(json: string): Backup {
  let parsed: Partial<Backup>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (parsed?.format !== BACKUP_FORMAT) {
    throw new Error('This is not a Nyatching List backup file.');
  }
  if (!Array.isArray(parsed.media) && !isValidSettings(parsed.settings) && !Array.isArray(parsed.notifications)) {
    throw new Error('This backup has nothing to import.');
  }
  return parsed as Backup;
}

/** Imports the picked parts the backup holds. Settings and theme are replaced; titles and notifications are merged. */
export async function importBackup(backup: Backup, choice: ImportChoice): Promise<ImportResult> {
  const result: ImportResult = {};

  if (choice.media && Array.isArray(backup.media)) {
    result.media = await mergeMedia(backup.media);
  }

  const s = backup.settings;
  if (choice.settings && isValidSettings(s)) {
    result.settings = await saveSettings({
      newSeasonCheckIntervalHours: s.newSeasonCheckIntervalHours,
      reminderIntervalHours: s.reminderIntervalHours,
    });
    if (isTheme(s.theme)) await setStorageData({ [THEME_STORAGE_KEY]: s.theme });
  }

  if (choice.notifications && Array.isArray(backup.notifications)) {
    result.notificationsAdded = await mergeNotifications(backup.notifications);
  }

  if (!result.media && !result.settings && result.notificationsAdded === undefined) {
    throw new Error('Nothing selected to import.');
  }
  return result;
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