import { TrackedMedia, Show, Movie, MediaStatus, isShow, isMovie } from '../types';

export interface StorageSchema {
  nyatching_list_media: TrackedMedia[];
}

const STORAGE_KEY: keyof StorageSchema = 'nyatching_list_media';
const VALID_STATUSES: MediaStatus[] = ['watching', 'waiting', 'completed', 'dropped'];

/**
 * Checks if chrome.storage API is available in the current context.
 */
function isStorageAvailable(): boolean {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        console.warn('[Nyatching List Storage] chrome.storage.local is not available.');
        return false;
    }
    return true;
}

/**
 * Generates a clean fallback ID from a title if no IMDb ID is provided.
 */
function generateFallbackId(title: string): string {
    const cleanTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return `manual-${cleanTitle}-${Date.now()}`;
}

/**
 * Safely writes to chrome.storage.local with error catching for quota limits.
 */
async function setStorageData(data: Record<string, unknown>): Promise<void> {
  if (!isStorageAvailable()) return;

  try {
    await chrome.storage.local.set(data);
  } catch (error) {
    if (chrome.runtime?.lastError) {
      console.error('[Nyatching List] Storage set failed:', chrome.runtime.lastError.message);
      throw new Error(`Storage operation failed: ${chrome.runtime.lastError.message}`);
    }
    throw error;
  }
}

// ==========================================
// LOW-LEVEL READ / WRITE OPERATIONS
// ==========================================

/**
 * Retrieves all stored media (both Shows and Movies).
 */
export async function getAllMedia(): Promise<TrackedMedia[]> {
    if (!isStorageAvailable()) return [];

    const data = (await chrome.storage.local.get(STORAGE_KEY)) as Partial<StorageSchema>;
    return data[STORAGE_KEY] ?? [];
}

/**
 * Retrieves only TV Shows.
 */
export async function getShows(): Promise<Show[]> {
    const media = await getAllMedia();
    return media.filter(isShow);
}

/**
 * Retrieves only Movies.
 */
export async function getMovies(): Promise<Movie[]> {
    const media = await getAllMedia();
    return media.filter(isMovie);
}

/**
 * Retrieves a single media item by its unique ID.
 */
export async function getMediaById(id: string): Promise<TrackedMedia | undefined> {
    const media = await getAllMedia();
    return media.find((item) => item.id === id);
}

/**
 * Saves a new media item or replaces an existing item matching item.id.
 */
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
// SEARCH, FILTER, AND SORT QUERY HELPER
// ==========================================

export interface MediaQueryOptions {
  status?: MediaStatus;
  mediaType?: 'show' | 'movie';
  searchTerm?: string;
  sortBy?: 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Queries stored media with optional status, mediaType, search term, and sorting.
 */
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
// HIGH-LEVEL ACTION HELPERS WITH VALIDATION
// ==========================================

export type AddMediaInput = 
  | ({ mediaType: 'show'; currentSeason: number; currentEpisode: number; totalSeasons?: number } & BaseAddInput)
  | ({ mediaType: 'movie'; currentMinutes: number; runtimeMinutes?: number; releaseYear?: number } & BaseAddInput);

interface BaseAddInput {
    id?: string; // Optional: use IMDb ID if available, auto-generate if manual
    title: string;
    status?: MediaStatus;
    watchingUrl?: string;
}

/**
 * Adds a new media item (Show or Movie) with input validation and duplicate prevention.
 */
export async function addMedia(input: AddMediaInput): Promise<TrackedMedia> {
    if (!input.title || typeof input.title !== 'string' || input.title.trim() === '') {
        throw new Error('[Nyatching List] Valid title is required.');
    }

    const trimmedTitle = input.title.trim();
    const existingMedia = await getAllMedia();

    const isDuplicate = existingMedia.some(
        (item) => item.title.toLowerCase() === trimmedTitle.toLowerCase()
    );
    if (isDuplicate) {
        throw new Error(`[Nyatching List] "${trimmedTitle}" is already in your list.`);
    }

    const finalId = input.id && input.id.trim() !== '' 
        ? input.id.trim() 
        : generateFallbackId(trimmedTitle);

    const status: MediaStatus = input.status ?? 'watching';
    if (!VALID_STATUSES.includes(status)) {
        throw new Error(`[Nyatching List] Invalid status "${status}".`);
    }

    const baseData = {
        id: finalId,
        title: trimmedTitle,
        status,
        watchingUrl: input.watchingUrl?.trim() || '',
        updatedAt: Date.now(),
    };

    let newItem: TrackedMedia;

    if (input.mediaType === 'show') {
        newItem = {
        ...baseData,
        mediaType: 'show',
        currentSeason: input.currentSeason ?? 1,
        currentEpisode: input.currentEpisode ?? 1,
        totalSeasons: input.totalSeasons,
        };
    } else {
        newItem = {
        ...baseData,
        mediaType: 'movie',
        currentMinutes: input.currentMinutes ?? 0,
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

/**
 * Generic update function to modify progress, status, or details for any media item.
 */
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

    if (isShow(existingItem)) {
        // Cast updates to Partial<Show> after runtime type narrowing
        const showUpdates = updates as Partial<Show>;
        const season = showUpdates.currentSeason ?? existingItem.currentSeason;
        const episode = showUpdates.currentEpisode ?? existingItem.currentEpisode;

        if (showUpdates.currentSeason !== undefined && (!Number.isInteger(season) || season < 1)) {
        throw new Error('[Nyatching List] Season must be an integer >= 1.');
        }
        if (showUpdates.currentEpisode !== undefined && (!Number.isInteger(episode) || episode < 1)) {
        throw new Error('[Nyatching List] Episode must be an integer >= 1.');
        }

        const updatedShow: Show = {
        ...existingItem,
        ...showUpdates,
        currentSeason: season,
        currentEpisode: episode,
        updatedAt: Date.now(),
        };

        await saveMedia(updatedShow);
        return updatedShow;
    }

    if (isMovie(existingItem)) {
        // Cast updates to Partial<Movie> after runtime type narrowing
        const movieUpdates = updates as Partial<Movie>;
        const minutes = movieUpdates.currentMinutes ?? existingItem.currentMinutes;

        if (movieUpdates.currentMinutes !== undefined && (!Number.isInteger(minutes) || minutes < 0)) {
        throw new Error('[Nyatching List] Current minutes must be a non-negative integer.');
        }

        const updatedMovie: Movie = {
        ...existingItem,
        ...movieUpdates,
        currentMinutes: minutes,
        updatedAt: Date.now(),
        };

        await saveMedia(updatedMovie);
        return updatedMovie;
    }

    throw new Error('[Nyatching List] Unsupported media type.');
}

// ==========================================
// DELETE & CLEAR OPERATIONS
// ==========================================

/**
 * Deletes a single media item by ID.
 */
export async function deleteMedia(id: string): Promise<void> {
    if (!isStorageAvailable()) return;

    const mediaList = await getAllMedia();
    const filteredList = mediaList.filter((item) => item.id !== id);

    await setStorageData({ [STORAGE_KEY]: filteredList });
}

/**
 * Clears all stored media from local storage.
 */
export async function clearAllMedia(): Promise<void> {
    if (!isStorageAvailable()) return;

    await chrome.storage.local.remove(STORAGE_KEY);
}

// ==========================================
// REACTIVE STORAGE LISTENER
// ==========================================

/**
 * Listens for changes to nyatching_list_media across extension views.
 * Returns an unbind function to stop listening.
 */
export function onMediaStorageChange(
    callback: (newMedia: TrackedMedia[]) => void
): () => void {
    if (!isStorageAvailable()) return () => {};

    const listener = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
    ) => {
        if (areaName === 'local' && changes[STORAGE_KEY]) {
        callback((changes[STORAGE_KEY].newValue as TrackedMedia[]) ?? []);
        }
    };

    chrome.storage.onChanged.addListener(listener);

    return () => {
        chrome.storage.onChanged.removeListener(listener);
  };
}