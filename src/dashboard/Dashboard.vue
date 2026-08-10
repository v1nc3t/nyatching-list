<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { TrackedMedia, Show, Movie, MediaStatus, isShow, isMovie } from '../types'
import { getAllMedia, updateMedia, deleteMedia, onMediaStorageChange } from '../storage'
import { useTheme } from '../utils/theme'

// Theme (Shared via chrome.storage.local)
const { theme, toggleTheme } = useTheme()

// Data State
const mediaList = ref<TrackedMedia[]>([])
const search = ref('')
const statusFilter = ref<MediaStatus | 'all'>('all')
const typeFilter = ref<'all' | 'show' | 'movie'>('all')

const loadMedia = async () => {
  mediaList.value = await getAllMedia()
}

onMounted(() => {
  loadMedia()
  onMediaStorageChange((newList) => {
    mediaList.value = newList
  })
})

// Metrics
const stats = computed(() => {
  const total = mediaList.value.length
  const watching = mediaList.value.filter((i) => i.status === 'watching').length
  const completed = mediaList.value.filter((i) => i.status === 'completed').length
  const shows = mediaList.value.filter(isShow).length
  const movies = mediaList.value.filter(isMovie).length
  return { total, watching, completed, shows, movies }
})

// Filtering & Sorting
const filteredMedia = computed(() => {
  return mediaList.value.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(search.value.toLowerCase().trim())
    const matchesStatus = statusFilter.value === 'all' || item.status === statusFilter.value
    const matchesType = typeFilter.value === 'all' || item.mediaType === typeFilter.value
    return matchesSearch && matchesStatus && matchesType;
  })
})

// Handlers
const handleIncrementEpisode = async (show: Show) => {
  await updateMedia({ id: show.id, currentEpisode: show.currentEpisode + 1 })
}

const handleIncrementSeason = async (show: Show) => {
  await updateMedia({ id: show.id, currentSeason: show.currentSeason + 1, currentEpisode: 1 })
}

const handleAddMinutes = async (movie: Movie, mins: number) => {
  await updateMedia({ id: movie.id, currentMinutes: movie.currentMinutes + mins })
}

const handleStatusChange = async (id: string, status: MediaStatus) => {
  await updateMedia({ id, status })
}

const handleDelete = async (id: string) => {
  if (confirm('Are you sure you want to remove this item?')) {
    await deleteMedia(id)
  }
}
</script>

<template>
  <div class="dashboard-root">
    <!-- Navigation Bar -->
    <header class="navbar">
      <div class="brand">
        <div>
          <h1>Nyatching List</h1>
          <p class="subtitle">Currently watching list</p>
        </div>
      </div>

      <div class="header-right">
        <button
          type="button"
          class="icon-btn"
          @click="toggleTheme"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
        >
          <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
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
          <svg v-else viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20.7 14.9A8.5 8.5 0 0 1 9.1 3.3a.75.75 0 0 0-.9-1 10 10 0 1 0 13.4 13.5.75.75 0 0 0-1-.9Z"
            />
          </svg>
        </button>
      </div>
    </header>

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
          <svg viewBox="0 0 24 24" width="16" height="16" class="search-icon">
            <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input v-model="search" type="text" placeholder="Search watchlist..." class="search-input" />
        </div>

        <div class="filter-group">
          <!-- Type Filter -->
          <div class="segmented">
            <button class="segment-btn" :class="{ active: typeFilter === 'all' }" @click="typeFilter = 'all'">All</button>
            <button class="segment-btn" :class="{ active: typeFilter === 'show' }" @click="typeFilter = 'show'">Shows</button>
            <button class="segment-btn" :class="{ active: typeFilter === 'movie' }" @click="typeFilter = 'movie'">Movies</button>
          </div>

          <!-- Status Filter Dropdown -->
          <select v-model="statusFilter" class="select-input">
            <option value="all">All Statuses</option>
            <option value="watching">Watching</option>
            <option value="waiting">Waiting</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
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
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <h3 class="card-title">
            <a v-if="item.watchingUrl" :href="item.watchingUrl" target="_blank" rel="noopener noreferrer">
              {{ item.title }} ↗
            </a>
            <span v-else>{{ item.title }}</span>
          </h3>

          <div class="card-bottom">
            <!-- TV Show Progress Controls -->
            <div v-if="isShow(item)" class="progress-box">
              <div class="progress-info">
                <span class="progress-label">Progress</span>
                <span class="progress-val">S{{ item.currentSeason }} : E{{ item.currentEpisode }}</span>
              </div>
              <div class="btn-group">
                <button class="small-btn" @click="handleIncrementEpisode(item)">+1 Ep</button>
                <button class="small-btn" @click="handleIncrementSeason(item)">+1 Szn</button>
              </div>
            </div>

            <!-- Movie Progress Controls -->
            <div v-else-if="isMovie(item)" class="progress-box">
              <div class="progress-info">
                <span class="progress-label">Watched</span>
                <span class="progress-val">{{ item.currentMinutes }}m</span>
              </div>
              <div class="btn-group">
                <button class="small-btn" @click="handleAddMinutes(item, 15)">+15m</button>
                <button class="small-btn" @click="handleAddMinutes(item, 30)">+30m</button>
              </div>
            </div>

            <!-- Status selector -->
            <div class="status-row">
              <select
                :value="item.status"
                class="status-select"
                :class="item.status"
                @change="handleStatusChange(item.id, ($event.target as HTMLSelectElement).value as MediaStatus)"
              >
                <option value="watching">Watching</option>
                <option value="waiting">Waiting</option>
                <option value="completed">Completed</option>
                <option value="dropped">Dropped</option>
              </select>
            </div>
          </div>
        </article>
      </div>
    </main>
  </div>
</template>

<style>
:root.theme-dark {
  --bg: #141414;
  --bg-card: #1f1f1f;
  --bg-input: #2a2a2a;
  --border: #333333;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --text-muted: #666666;
  --accent: #42b983;
  --accent-hover: #369b6e;
  --accent-contrast: #121212;
  --shadow: rgba(0, 0, 0, 0.4);
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
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>

<style scoped>
.dashboard-root {
  min-height: 100vh;
}

.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2.5rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}

.logo {
  font-size: 1.8rem;
}

.brand h1 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.02em;
  line-height: 1.1;
}

.subtitle {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.icon-btn {
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-primary);
  width: 2.2rem;
  height: 2.2rem;
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

.content {
  max-width: 1150px;
  margin: 0 auto;
  padding: 2rem 2.5rem;
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  box-shadow: 0 2px 6px var(--shadow);
}

.stat-card.accent {
  border-color: var(--accent);
}

.stat-label {
  font-size: 0.72rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-top: 0.25rem;
}

.stat-card.accent .stat-value {
  color: var(--accent);
}

/* Toolbar */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.75rem;
  flex-wrap: wrap;
}

.search-box {
  position: relative;
  flex: 1;
  min-width: 240px;
}

.search-icon {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 0.6rem 0.85rem 0.6rem 2.4rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.85rem;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.filter-group {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.segmented {
  display: inline-flex;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.2rem;
  gap: 0.2rem;
}

.segment-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 0.4rem 0.85rem;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}

.segment-btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.select-input, .status-select {
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.82rem;
}

/* Grid */
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.25rem;
}

.media-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.15rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: 0 2px 8px var(--shadow);
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.media-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.type-badge {
  font-size: 0.65rem;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.type-badge.show { background: rgba(144, 202, 249, 0.15); color: #90caf9; }
.type-badge.movie { background: rgba(244, 143, 177, 0.15); color: #f48fb1; }

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

.card-title {
  margin: 0 0 1.25rem 0;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
}

.card-title a {
  color: var(--text-primary);
  text-decoration: none;
}

.card-title a:hover { color: var(--accent); }

.progress-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-input);
  padding: 0.6rem 0.85rem;
  border-radius: 8px;
  margin-bottom: 0.85rem;
}

.progress-info {
  display: flex;
  flex-direction: column;
}

.progress-label {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.progress-val {
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--text-primary);
}

.btn-group {
  display: flex;
  gap: 0.3rem;
}

.small-btn {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--accent);
  padding: 0.3rem 0.5rem;
  border-radius: 5px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.small-btn:hover { background: var(--accent); color: var(--accent-contrast); }

.status-row {
  display: flex;
  width: 100%;
}

.status-select {
  width: 100%;
  cursor: pointer;
  font-weight: 500;
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 12px;
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.empty-state h3 {
  margin: 0 0 0.5rem 0;
  color: var(--text-primary);
}

.empty-state p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>