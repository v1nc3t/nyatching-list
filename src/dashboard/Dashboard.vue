<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  TrackedMedia,
  Show,
  Movie,
  MediaStatus,
  NotificationItem,
  isShow,
  isMovie,
} from '../types'
import {
  getAllMedia,
  updateMedia,
  deleteMedia,
  onMediaStorageChange,
  getNotificationLog,
  deleteNotificationLogItem,
  clearAllNotificationLogs,
} from '../storage'
import browser from 'webextension-polyfill'
import { useTheme } from '../utils/theme'
import SettingsModal from './Settings.vue'

// Theme (Shared via extension storage)
const { theme, toggleTheme } = useTheme()

// Settings & Notification Drawer State
const isSettingsOpen = ref(false)
const isNotificationsOpen = ref(false)
const notificationLogs = ref<NotificationItem[]>([])

// Data State
const mediaList = ref<TrackedMedia[]>([])
const search = ref('')
const statusFilter = ref<MediaStatus | 'all'>('all')
const typeFilter = ref<'all' | 'show' | 'movie'>('all')
const githubLink = ref('https://github.com/v1nc3t/nyatching-list')
const supportLink = ref('https://buymeacoffee.com/v1c3nt')

const loadMedia = async () => {
  mediaList.value = await getAllMedia()
}

const loadNotifications = async () => {
  notificationLogs.value = await getNotificationLog()
}

onMounted(() => {
  loadMedia()
  loadNotifications()

  // Reactive Storage Updates
  onMediaStorageChange((newList) => {
    mediaList.value = newList
  })

  // Storage listener for background notifications update
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.nyatching_notification_log) {
      notificationLogs.value = (changes.nyatching_notification_log.newValue as NotificationItem[]) || []
    }
  })
})

// Unread Notification Count
const unreadCount = computed(() => notificationLogs.value.filter((n) => !n.read).length)

// Notification Handlers
const handleDismissNotification = async (id: string) => {
  notificationLogs.value = await deleteNotificationLogItem(id)
}

const handleClearAllNotifications = async () => {
  await clearAllNotificationLogs()
  notificationLogs.value = []
}

const formatTimestamp = (ts: number): string => {
  const diffMs = Date.now() - ts
  const diffMins = Math.floor(diffMs / (1000 * 60))
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

// Track image load errors to fallback gracefully
const failedPosters = ref<Record<string, boolean>>({})
const handlePosterError = (id: string) => {
  failedPosters.value[id] = true
}

// Metrics
const stats = computed(() => {
  const total = mediaList.value.length
  const watching = mediaList.value.filter((i) => i.status === 'watching').length
  const completed = mediaList.value.filter((i) => i.status === 'completed').length
  const shows = mediaList.value.filter(isShow)
  const movies = mediaList.value.filter(isMovie).length

  // Counts shows that are actively tracked (defaults to true if undefined)
  const tracked = shows.filter(
    (s) => isTrackableStatus(s.status) && (s.tracked ?? true)
  ).length

  return { total, watching, completed, shows: shows.length, movies, tracked }
})

// Filtering & Sorting
const filteredMedia = computed(() => {
  return mediaList.value.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(search.value.toLowerCase().trim())
    const matchesStatus = statusFilter.value === 'all' || item.status === statusFilter.value
    const matchesType = typeFilter.value === 'all' || item.mediaType === typeFilter.value
    return matchesSearch && matchesStatus && matchesType
  })
})

// Handlers for Show
const handleEpisodeChange = async (show: Show, delta: number) => {
  const nextEpisode = Math.max(1, show.currentEpisode + delta)
  await updateMedia({ id: show.id, currentEpisode: nextEpisode })
}

const handleSeasonChange = async (show: Show, delta: number) => {
  let nextSeason = Math.max(1, show.currentSeason + delta)

  if (show.totalSeasons && show.totalSeasons > 0) {
    nextSeason = Math.min(nextSeason, show.totalSeasons)
  }

  await updateMedia({ id: show.id, currentSeason: nextSeason, currentEpisode: 1 })
}

// Track Toggle Helper
const isTrackableStatus = (status: MediaStatus) => status === 'watching' || status === 'waiting'

const handleTrackToggle = async (show: Show) => {
  if (!isTrackableStatus(show.status)) return

  const currentlyTracked = show.tracked ?? true
  await updateMedia({ id: show.id, tracked: !currentlyTracked })
}

// Handlers for Movie
const handleMinutesChange = async (movie: Movie, delta: number) => {
  let nextMinutes = Math.max(0, movie.currentMinutes + delta)
  let updatedStatus: MediaStatus = movie.status

  if (movie.runtimeMinutes && movie.runtimeMinutes > 0) {
    if (nextMinutes >= movie.runtimeMinutes) {
      nextMinutes = movie.runtimeMinutes
      updatedStatus = 'completed'
    } else if (delta < 0 && movie.status === 'completed') {
      updatedStatus = 'watching'
    }
  }

  await updateMedia({ id: movie.id, currentMinutes: nextMinutes, status: updatedStatus })
}

const handleMinutesWheel = (event: WheelEvent, movie: Movie) => {
  if (document.activeElement !== event.currentTarget) return
  const delta = event.deltaY < 0 ? 5 : -5
  handleMinutesChange(movie, delta)
}

const handleMinutesInput = async (event: Event, movie: Movie) => {
  const target = event.target as HTMLInputElement
  let newMinutes = parseInt(target.value, 10)

  if (isNaN(newMinutes) || newMinutes < 0) {
    newMinutes = 0
  }

  let updatedStatus: MediaStatus = movie.status

  if (movie.runtimeMinutes && movie.runtimeMinutes > 0) {
    if (newMinutes >= movie.runtimeMinutes) {
      newMinutes = movie.runtimeMinutes
      updatedStatus = 'completed'
    } else if (movie.status === 'completed') {
      updatedStatus = 'watching'
    }
  }

  await updateMedia({ id: movie.id, currentMinutes: newMinutes, status: updatedStatus })
}

const handleStatusChange = async (item: TrackedMedia, newStatus: MediaStatus) => {
  if (isShow(item)) {
    const updates: Partial<Show> & { id: string } = { id: item.id, status: newStatus }

    if (!isTrackableStatus(newStatus)) {
      updates.tracked = false
    } else if (!isTrackableStatus(item.status) && isTrackableStatus(newStatus)) {
      updates.tracked = true
    }

    await updateMedia(updates)
  } else {
    await updateMedia({ id: item.id, status: newStatus })
  }
}

const handleDelete = async (id: string) => {
  if (confirm('Are you sure you want to remove this item?')) {
    await deleteMedia(id)
  }
}

const formatStatus = (s: string) => (s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1))
</script>

<template>
  <div class="dashboard-root">
    <!-- Navigation Bar -->
    <header class="navbar">
      <div class="brand">
        <div>
          <h1>NYATCHING LIST</h1>
        </div>
      </div>

      <div class="header-right">
        <div class="header-actions">
          <!-- Notification Bell Button with Badge -->
          <button
            type="button"
            class="icon-btn notif-btn"
            @click="isNotificationsOpen = !isNotificationsOpen"
            aria-label="Notifications"
            title="Notifications Log"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span v-if="unreadCount > 0" class="notif-badge">
              {{ unreadCount > 9 ? '9+' : unreadCount }}
            </span>
          </button>

          <!-- Notification Settings Button -->
          <button
            type="button"
            class="icon-btn"
            @click="isSettingsOpen = true"
            aria-label="Notification Settings"
            title="Notification Settings"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          <!-- Theme Toggle Button -->
          <button
            type="button"
            class="icon-btn"
            @click="toggleTheme"
            :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
            :title="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
          >
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <circle cx="12" cy="12" r="4.5" fill="currentColor" />
              <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                <line x1="12" y1="1.5" x2="12" y2="4" />
                <line x1="12" y1="20" x2="12" y2="22.5" />
                <line x1="1.5" y1="12" x2="4" y2="12" />
                <line x1="20" y1="12" x2="22.5" y2="12" />
                <line x1="4.5" y1="4.5" x2="6.2" y2="6.2" />
                <line x1="17.8" y1="17.8" x2="19.5" y2="19.5" />
                <line x1="4.5" y1="19.5" x2="6.2" y2="17.8" />
                <line x1="17.8" y1="6.2" x2="19.5" y2="4.5" />
              </g>
            </svg>
            <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M20.7 14.9A8.5 8.5 0 0 1 9.1 3.3a.75.75 0 0 0-.9-1 10 10 0 1 0 13.4 13.5.75.75 0 0 0-1-.9Z"
              />
            </svg>
          </button>
        </div>

        <!-- Settings Modal Portal -->
        <SettingsModal v-if="isSettingsOpen" @close="isSettingsOpen = false" />
      </div>
    </header>

    <!-- Slide-over Notifications Drawer -->
    <aside v-if="isNotificationsOpen" class="notif-drawer-overlay" @click.self="isNotificationsOpen = false">
      <div class="notif-drawer">
        <div class="drawer-header">
          <h3>Notifications Log</h3>
          <div class="drawer-actions">
            <button
              v-if="notificationLogs.length > 0"
              class="clear-all-btn"
              @click="handleClearAllNotifications"
            >
              Clear Log
            </button>
            <button class="delete-btn" title="Delete" @click="isNotificationsOpen = false">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div class="drawer-content">
          <div v-if="notificationLogs.length === 0" class="notif-empty">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p>No recent release notifications</p>
          </div>

          <div v-else class="notif-list">
            <div
              v-for="item in notificationLogs"
              :key="item.id"
              class="notif-item"
            >
              <div v-if="item.posterPath" class="notif-poster">
                <img :src="item.posterPath" :alt="item.title" />
              </div>

              <div class="notif-body">
                <div class="notif-title-row">
                  <span class="notif-title">{{ item.title }}</span>
                  <span class="notif-time">{{ formatTimestamp(item.timestamp) }}</span>
                </div>
                <p class="notif-msg">{{ item.message }}</p>
              </div>

              <button
                class="dismiss-notif-btn"
                title="Dismiss"
                @click="handleDismissNotification(item.id)"
              >
                &times;
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <main class="content">
      <!-- Overview Metrics Cards -->
      <section class="stats-row">
        <div class="stat-card">
          <span class="stat-label">Total Media</span>
          <span class="stat-value">{{ stats.total }}</span>
        </div>
        <div class="stat-card accent">
          <span class="stat-label">Currently Watching</span>
          <span class="stat-value">{{ stats.watching }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Completed</span>
          <span class="stat-value">{{ stats.completed }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Shows / Movies</span>
          <span class="stat-value">{{ stats.shows }} / {{ stats.movies }}</span>
        </div>
      </section>

      <!-- Toolbar Search & Controls -->
      <section class="toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" width="18" height="18" class="search-icon">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input v-model="search" type="text" placeholder="Search watchlist..." class="search-input" />
        </div>

        <div class="filter-group">
          <div class="segmented">
            <button class="segment-btn" :class="{ active: typeFilter === 'all' }" @click="typeFilter = 'all'">All</button>
            <button class="segment-btn" :class="{ active: typeFilter === 'show' }" @click="typeFilter = 'show'">Shows</button>
            <button class="segment-btn" :class="{ active: typeFilter === 'movie' }" @click="typeFilter = 'movie'">Movies</button>
          </div>

          <!-- Custom Toolbar Status Dropdown -->
          <div class="select toolbar-select">
            <div class="selected">
              <span>{{ formatStatus(statusFilter) }}</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                height="1em"
                viewBox="0 0 512 512"
                class="arrow"
              >
                <path
                  d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
                ></path>
              </svg>
            </div>
            <div class="options">
              <label
                v-for="st in (['all', 'watching', 'waiting', 'completed', 'dropped'] as (MediaStatus | 'all')[])"
                :key="st"
                class="option-item"
                :class="{ active: statusFilter === st }"
                @click="statusFilter = st"
              >
                {{ formatStatus(st) }}
              </label>
            </div>
          </div>
        </div>
      </section>

      <!-- Media Grid -->
      <div v-if="filteredMedia.length === 0" class="empty-state">
        <h3>No media found</h3>
        <p v-if="search || statusFilter !== 'all' || typeFilter !== 'all'">Try clearing your active filters.</p>
        <p v-else>Use the popup extension menu to add your first show or movie!</p>
      </div>

      <div v-else class="media-grid">
        <article v-for="item in filteredMedia" :key="item.id" class="media-card">
          <div class="card-top">
            <span class="type-badge" :class="item.mediaType">{{ item.mediaType }}</span>
            <button class="delete-btn" title="Delete" @click="handleDelete(item.id)">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Header Layout with Poster / Placeholder -->
          <div class="card-header-main">
            <div class="poster-container">
              <img
                v-if="item.posterPath && !failedPosters[item.id]"
                :src="item.posterPath"
                :alt="item.title"
                class="poster-img"
                loading="lazy"
                @error="handlePosterError(item.id)"
              />
              <div v-else class="poster-placeholder">
                <svg viewBox="0 0 24 24" width="22" height="22" class="poster-icon" aria-hidden="true">
                  <path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            </div>

            <h3 class="card-title">
              <a v-if="item.watchingUrl" :href="item.watchingUrl" target="_blank" rel="noopener noreferrer">
                {{ item.title }}
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" class="link-icon">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
                  />
                </svg>
              </a>
              <span v-else>{{ item.title }}</span>
            </h3>
          </div>

          <div class="card-bottom">
            <!-- TV Show Progress Controls -->
            <div v-if="isShow(item)" class="progress-container">
              <div class="progress-box">
                <div class="progress-info">
                  <span class="progress-label">Season</span>
                  <span class="progress-val">
                    {{ item.currentSeason }}
                    <span v-if="item.totalSeasons" class="total-val">/ {{ item.totalSeasons }}</span>
                  </span>
                </div>
                <div class="btn-group">
                  <button class="stepper-btn" :disabled="item.currentSeason <= 1" @click="handleSeasonChange(item, -1)">-</button>
                  <button 
                    class="stepper-btn" 
                    :disabled="!!item.totalSeasons && item.currentSeason >= item.totalSeasons" 
                    @click="handleSeasonChange(item, 1)"
                  >+</button>
                </div>
              </div>

              <div class="progress-box">
                <div class="progress-info">
                  <span class="progress-label">Episode</span>
                  <span class="progress-val">{{ item.currentEpisode }}</span>
                </div>
                <div class="btn-group">
                  <button class="stepper-btn" :disabled="item.currentEpisode <= 1" @click="handleEpisodeChange(item, -1)">-</button>
                  <button class="stepper-btn" @click="handleEpisodeChange(item, 1)">+</button>
                </div>
              </div>
            </div>

            <!-- Movie Progress Controls -->
            <div v-else-if="isMovie(item)" class="progress-container">
              <div class="progress-box scrollable-input-box">
                <div class="progress-info">
                  <span class="progress-label">Minutes Watched</span>
                </div>
                
                <div class="input-wrapper">
                  <input
                    type="number"
                    min="0"
                    :max="item.runtimeMinutes || undefined"
                    :value="item.currentMinutes"
                    class="minutes-scroll-input"
                    @input="handleMinutesInput($event, item)"
                    @wheel.prevent="handleMinutesWheel($event, item)"
                  />
                  <span v-if="item.runtimeMinutes" class="runtime-suffix">/ {{ item.runtimeMinutes }}m</span>
                  <span v-else class="runtime-suffix">m</span>
                </div>
              </div>
            </div>

            <!-- Side-by-Side Status Row -->
            <div class="status-row-box">
              <span class="status-label">Status</span>
              <div class="select">
                <div class="selected">
                  <span>{{ formatStatus(item.status) }}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="1em"
                    viewBox="0 0 512 512"
                    class="arrow"
                  >
                    <path
                      d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
                    ></path>
                  </svg>
                </div>
                <div class="options">
                  <label
                    v-for="st in (['watching', 'waiting', 'completed', 'dropped'] as MediaStatus[])"
                    :key="st"
                    class="option-item"
                    :class="{ active: item.status === st }"
                    @click="handleStatusChange(item, st)"
                  >
                    {{ formatStatus(st) }}
                  </label>
                </div>
              </div>
            </div>

            <!-- SHOW ONLY: Automatic Tracking Row (Under Status) -->
            <div v-if="isShow(item)" class="track-row-box" :class="{ disabled: !isTrackableStatus(item.status) }">
              <div class="track-info">
                <span class="track-label">Updates</span>
                <span
                  class="track-status"
                  :class="{ active: isTrackableStatus(item.status) && (item.tracked ?? true) }"
                >
                  <template v-if="!isTrackableStatus(item.status)">Unavailable</template>
                  <template v-else>{{ (item.tracked ?? true) ? 'Active' : 'Disabled' }}</template>
                </span>
              </div>

              <button
                type="button"
                class="track-toggle-btn"
                :class="{ 
                  'is-tracking': isTrackableStatus(item.status) && (item.tracked ?? true),
                  'is-disabled': !isTrackableStatus(item.status)
                }"
                :disabled="!isTrackableStatus(item.status)"
                @click="handleTrackToggle(item)"
                :title="
                  !isTrackableStatus(item.status)
                    ? 'Tracking is only available for shows in Watching or Waiting status'
                    : (item.tracked ?? true)
                    ? 'Disable automatic updates for this show'
                    : 'Enable automatic updates for this show'
                "
              >
                <svg
                  v-if="isTrackableStatus(item.status) && (item.tracked ?? true)"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <span>
                  {{ !isTrackableStatus(item.status) ? 'Off' : (item.tracked ?? true) ? 'Tracked' : 'Track' }}
                </span>
              </button>
            </div>
          </div>
        </article>
      </div>
    </main>

    <!-- Footer -->
    <footer class="site-footer">
      <a :href="githubLink" target="_blank" rel="noopener noreferrer" class="footer-link">
        created by v1nc3t
      </a>
      <span class="footer-divider" aria-hidden="true">•</span>
      <a :href="supportLink" target="_blank" rel="noopener noreferrer" class="footer-link">
        support v1nc3t
      </a>
    </footer>
  </div>
</template>

<style>
:root.theme-dark {
  --bg: #09090b;
  --bg-card: #121215;
  --bg-input: #18181c;
  --border: #27272a;
  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;
  --accent: #10b981;
  --accent-hover: #059669;
  --accent-contrast: #000000;
  --shadow: rgba(0, 0, 0, 0.65);

  /* Badge Text Colors for Dark Mode */
  --show-text: #005f88;
  --movie-text: #762850;
}

:root.theme-light {
  --bg: #f8f9fa;
  --bg-card: #ffffff;
  --bg-input: #f1f3f5;
  --border: #e9ecef;
  --text-primary: #212529;
  --text-secondary: #6c757d;
  --text-muted: #adb5bd;
  --accent: #2f9d6f;
  --accent-hover: #26855d;
  --accent-contrast: #ffffff;
  --shadow: rgba(0, 0, 0, 0.05);

  /* Badge Text Colors for Light Mode */
  --show-text: #004f77;
  --movie-text: #8c1a4d;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
}
</style>

<style scoped>
.dashboard-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.15rem 2.5rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

.header-right {
  display: flex;
  align-items: center;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand h1 {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.02em;
  line-height: 1.1;
}

.icon-btn {
  position: relative;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-primary);
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.15s ease;
}

.icon-btn:hover {
  border-color: var(--accent);
}

/* Notification Bell Badge */
.notif-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  background: #ef4444;
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0.1rem 0.35rem;
  border-radius: 10px;
  border: 2px solid var(--bg-card);
  line-height: 1;
}

/* Slide-Over Notification Drawer */
.notif-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(2px);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.notif-drawer {
  width: 380px;
  max-width: 90vw;
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px var(--shadow);
}

.drawer-header {
  padding: 1.25rem;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.drawer-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 700;
}

.drawer-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.clear-all-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.clear-all-btn:hover {
  color: #ef4444;
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted);
  gap: 0.5rem;
}

.notif-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.notif-item {
  position: relative;
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.notif-poster {
  width: 36px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
}

.notif-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.notif-body {
  flex: 1;
  min-width: 0;
}

.notif-title-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
}

.notif-title {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notif-time {
  font-size: 0.7rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.notif-msg {
  margin: 0.25rem 0 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.3;
}

.dismiss-notif-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 0.2rem;
  align-self: flex-start;
}

.dismiss-notif-btn:hover {
  color: #ef4444;
}

.content {
  max-width: 1250px;
  width: 100%;
  box-sizing: border-box;
  margin: 0 auto;
  padding: 2rem 2.5rem;
  flex: 1;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1.15rem;
  margin-bottom: 2.25rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.15rem 1.35rem;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 6px var(--shadow);
}

.stat-card.accent {
  border-color: var(--accent);
}

.stat-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat-value {
  font-size: 2.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0.35rem;
}

.stat-card.accent .stat-value {
  color: var(--accent);
}

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.25rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 240px;
}

.search-icon {
  position: absolute;
  left: 0.95rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 0.7rem 0.95rem 0.7rem 2.6rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.95rem;
  box-sizing: border-box;
  height: 2.55rem;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.filter-group {
  display: flex;
  gap: 0.85rem;
  align-items: center;
}

.segmented {
  display: inline-flex;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.25rem;
  gap: 0.25rem;
  height: 2.55rem;
  box-sizing: border-box;
  align-items: center;
}

.segment-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 0.35rem 0.85rem;
  border-radius: 6px;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  height: 100%;
}

.segment-btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.toolbar-select {
  min-width: 145px;
}

.toolbar-select .selected {
  height: 2.55rem;
  padding: 0 0.85rem;
  border-radius: 8px;
  font-size: 0.9rem;
  box-sizing: border-box;
}

/* Equal-Size Uniform Grid Layout */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1.25rem;
}

.media-card {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 2px 8px var(--shadow);
  transition: transform 0.15s ease, border-color 0.15s ease;
  z-index: 1;
}

.media-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
  z-index: 10;
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.type-badge {
  font-size: 0.68rem;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-weight: 800;
  letter-spacing: 0.05em;
  background-color: var(--bg-input);
  border: 1px solid var(--border);
  transition: color 0.15s ease, background-color 0.15s ease;
}

.type-badge.show {
  color: var(--show-text);
}

.type-badge.movie {
  color: var(--movie-text);
}

.delete-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.2rem;
  display: flex;
  align-items: center;
}

.delete-btn:hover { color: #ff5252; }

/* Poster Container & Card Header */
.card-header-main {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-bottom: 1rem;
}

.poster-container {
  width: 54px;
  height: 76px;
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-input);
  border: 1px solid var(--border);
}

.poster-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.poster-placeholder {
  width: 100%;
  height: 100%;
  border: 1px dashed var(--border);
  box-sizing: border-box;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.poster-icon {
  color: var(--text-muted);
}

.card-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
}

.card-title a {
  color: var(--text-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.card-title a:hover { color: var(--accent); }

.link-icon {
  flex-shrink: 0;
}

.card-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.progress-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-input);
  padding: 0.55rem 0.75rem;
  border-radius: 8px;
}

.scrollable-input-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.input-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.2rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.2rem 0.45rem;
  transition: border-color 0.12s ease;
}

.input-wrapper:focus-within {
  border-color: var(--accent);
}

.minutes-scroll-input {
  width: 3rem;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.92rem;
  font-weight: 700;
  text-align: right;
  outline: none;
  padding: 0;
  margin: 0;
  line-height: 1;
  -appearance: textfield;
}

.minutes-scroll-input::-webkit-outer-spin-button,
.minutes-scroll-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.runtime-suffix {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
}

.progress-info {
  display: flex;
  flex-direction: column;
}

.progress-label, .status-label, .track-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 700;
}

.progress-val {
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text-primary);
}

.total-val {
  font-size: 0.8rem;
  color: var(--text-muted);
  font-weight: 500;
}

.btn-group {
  display: flex;
  gap: 0.25rem;
}

.stepper-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--accent);
  padding: 0.25rem 0.55rem;
  border-radius: 5px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.stepper-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-contrast);
}

.stepper-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* Show Tracking Row Box */
.track-row-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-input);
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  border: 1px dashed var(--border);
  transition: opacity 0.15s ease;
}

.track-row-box.disabled {
  opacity: 0.6;
}

.track-info {
  display: flex;
  flex-direction: column;
}

.track-status {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
  transition: color 0.15s ease;
}

.track-status.active {
  color: var(--accent);
}

.track-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 0.25rem 0.65rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.track-toggle-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-primary);
}

.track-toggle-btn.is-tracking {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
}

.track-toggle-btn.is-tracking:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.track-toggle-btn.is-disabled {
  cursor: not-allowed;
  opacity: 0.6;
  border-color: var(--border);
}

/* Status Row & Interactive Uiverse Select */
.status-row-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-input);
  padding: 0.45rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.select {
  cursor: pointer;
  position: relative;
  color: var(--text-primary);
}

.select::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  height: 6px;
}

.selected {
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: border-color 0.2s ease;
}

.arrow {
  height: 8px;
  width: 12px;
  transform: rotate(-90deg);
  fill: var(--text-primary);
  transition: transform 200ms ease;
}

.options {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  padding: 0.3rem;
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 4px 14px var(--shadow);
  position: absolute;
  top: 100%;
  right: 0;
  width: 125px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  transform: translateY(-2px);
  z-index: 100;
}

.select:hover > .options {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
}

.select:hover > .selected .arrow {
  transform: rotate(0deg);
}

.option-item {
  border-radius: 5px;
  padding: 0.35rem 0.55rem;
  transition: background-color 150ms ease, color 150ms ease;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--text-primary);
  cursor: pointer;
}

.option-item:hover {
  background-color: var(--bg-input);
  color: var(--accent);
}

.option-item.active {
  background-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 700;
}

.empty-state {
  text-align: center;
  padding: 4.5rem 2rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 12px;
}

.empty-state h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
  color: var(--text-primary);
}

.empty-state p {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.site-footer {
  padding: 1rem 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.footer-link {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.2s ease, text-decoration-color 0.2s ease;
}

.footer-link:hover {
  color: var(--accent);
  text-decoration: line-through;
  text-decoration-color: var(--accent);
}

.footer-divider {
  font-size: 0.75rem;
  color: var(--border);
}
</style>