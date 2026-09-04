<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import browser from 'webextension-polyfill'
import { MediaStatus } from '../types'
import { getAllMedia, addMedia, onMediaStorageChange, AddMediaInput } from '../storage'
import { useTheme } from '../utils/theme'
import {
  searchTMDB,
  getTMDBDetails,
  fetchTmdbByImdbId,
  parseTMDBShowInfo,
  getAiredEpisodeCountForSeason,
  completedProgressFromShowInfo,
  TMDBSuggestion,
  TMDBShowInfo,
} from '../services/tmdb'
import { checkShowReleases } from '../background/release-poll'

// Theme (Shared via extension storage)
const { theme, toggleTheme } = useTheme()

// Open Dashboard Handler
const openDashboard = async () => {
  try {
    await browser.runtime.openOptionsPage()
  } catch {
    window.open(browser.runtime.getURL('src/dashboard/dashboard.html'))
  }
}

// State
const mediaCount = ref(0)
const isModalOpen = ref(false)
const errorMessage = ref('')
const githubLink = ref('https://github.com/v1nc3t/nyatching-list')
const supportLink = ref('https://buymeacoffee.com/v1c3nt')
const isImdbPage = ref(false)

// Form State
const formType = ref<'show' | 'movie'>('show')
const formTitle = ref('')
const formUrl = ref('')
const formStatus = ref<MediaStatus>('watching')
const formSeason = ref(1)
const formEpisode = ref(1)
const formMinutes = ref(0)
const formRuntimeMinutes = ref('')
const formTotalSeasons = ref('')
const formTotalEpisodes = ref('')
const formReleaseYear = ref('')
const selectedPosterPath = ref<string | undefined>(undefined)
const selectedTmdbId = ref<number | undefined>(undefined)
const tmdbShowInfo = ref<TMDBShowInfo | null>(null)

// TMDB Auto-complete State
const suggestions = ref<TMDBSuggestion[]>([])
const showSuggestions = ref(false)
const isSelectingSuggestion = ref(false)
let debounceTimer: ReturnType<typeof setTimeout>

// Auto-detect Active Tab if on IMDb Title Page
const detectImdbActiveTab = async (autoOpenModal = true) => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (!tab || !tab.url) return

    const imdbMatch = tab.url.match(/\/title\/(tt\d+)/i)
    if (imdbMatch && imdbMatch[1]) {
      isImdbPage.value = true
      const imdbId = imdbMatch[1]
      
      const tmdbData = await fetchTmdbByImdbId(imdbId)

      if (tmdbData) {
        // Check if media is already saved in local storage
        const currentList = await getAllMedia()
        const canonicalUrl = `https://www.imdb.com/title/${imdbId}/`

        const exists = currentList.some(
          (item) =>
            (tmdbData.tmdbId && item.tmdbId === tmdbData.tmdbId) ||
            (item.watchingUrl && item.watchingUrl.toLowerCase().includes(imdbId.toLowerCase()))
        )

        if (exists) {
          errorMessage.value = 'Item is already in your watchlist'
          isModalOpen.value = false
          return
        }

        isSelectingSuggestion.value = true
        formTitle.value = tmdbData.title
        formType.value = tmdbData.mediaType
        formUrl.value = ''
        selectedPosterPath.value = tmdbData.posterPath
        selectedTmdbId.value = tmdbData.tmdbId

        if (tmdbData.releaseYear) {
          formReleaseYear.value = tmdbData.releaseYear.toString()
        }
        if (tmdbData.mediaType === 'show') {
          tmdbShowInfo.value = tmdbData.showInfo ?? null
          if (tmdbData.totalSeasons) {
            formTotalSeasons.value = tmdbData.totalSeasons.toString()
          }
          applyShowProgressFromTmdb()
        } else if (tmdbData.mediaType === 'movie' && tmdbData.runtimeMinutes) {
          formRuntimeMinutes.value = tmdbData.runtimeMinutes.toString()
          applyCompletedProgress()
        }

        if (autoOpenModal) {
          isModalOpen.value = true
        }
      }
    } else {
      isImdbPage.value = false
    }
  } catch (err) {
    console.error('Failed to detect IMDb tab:', err)
  }
}

const applyCompletedProgress = () => {
  if (formStatus.value !== 'completed') return

  if (formType.value === 'show') {
    if (tmdbShowInfo.value) {
      const progress = completedProgressFromShowInfo(tmdbShowInfo.value)
      formSeason.value = progress.currentSeason
      formEpisode.value = progress.currentEpisode
      formTotalSeasons.value = progress.totalSeasons.toString()
      formTotalEpisodes.value = progress.totalEpisodes.toString()
      return
    }

    const totalSeasons = Number(formTotalSeasons.value)
    if (formTotalSeasons.value !== '' && !isNaN(totalSeasons) && totalSeasons > 0) {
      formSeason.value = totalSeasons
    }
    const totalEpisodes = Number(formTotalEpisodes.value)
    if (formTotalEpisodes.value !== '' && !isNaN(totalEpisodes) && totalEpisodes > 0) {
      formEpisode.value = totalEpisodes
    }
    return
  }

  const runtime = Number(formRuntimeMinutes.value)
  if (formRuntimeMinutes.value !== '' && !isNaN(runtime) && runtime > 0) {
    formMinutes.value = runtime
  }
}

const applyShowProgressFromTmdb = () => {
  const info = tmdbShowInfo.value
  if (!info) return

  formTotalSeasons.value = info.totalSeasons.toString()

  if (formStatus.value === 'completed') {
    applyCompletedProgress()
    return
  }

  formSeason.value = 1
  formEpisode.value = 1
  const seasonOneAired = getAiredEpisodeCountForSeason(info, 1)
  formTotalEpisodes.value = seasonOneAired ? seasonOneAired.toString() : ''
}

// Clamp season against total seasons and sync episode count for the selected season
watch(formTotalSeasons, () => {
  const total = Number(formTotalSeasons.value)
  if (formTotalSeasons.value !== '' && !isNaN(total) && total > 0 && formSeason.value > total) {
    formSeason.value = total
  }
})

watch(formSeason, (newSeason) => {
  const total = Number(formTotalSeasons.value)
  if (formTotalSeasons.value !== '' && !isNaN(total) && total > 0) {
    if (newSeason > total) {
      formSeason.value = total
      return
    }
  }
  if (newSeason < 1) {
    formSeason.value = 1
    return
  }

  const info = tmdbShowInfo.value
  if (info) {
    const airedCount = getAiredEpisodeCountForSeason(info, newSeason)
    formTotalEpisodes.value = airedCount ? airedCount.toString() : ''
    if (airedCount && formEpisode.value > airedCount) {
      formEpisode.value = airedCount
    }
  }
})

watch(formTotalEpisodes, () => {
  const total = Number(formTotalEpisodes.value)
  if (formTotalEpisodes.value !== '' && !isNaN(total) && total > 0 && formEpisode.value > total) {
    formEpisode.value = total
  }
})

watch(formType, () => {
  if (formStatus.value === 'completed') {
    applyCompletedProgress()
  }
})

watch([formTotalSeasons, formTotalEpisodes, formRuntimeMinutes], () => {
  if (formStatus.value === 'completed') {
    applyCompletedProgress()
  }
})

// Watch Title Input for Live Suggestions
watch(formTitle, (newVal) => {
  if (isSelectingSuggestion.value) {
    isSelectingSuggestion.value = false
    return
  }

  clearTimeout(debounceTimer)

  if (!newVal || newVal.trim().length < 2) {
    suggestions.value = []
    showSuggestions.value = false
    return
  }

  debounceTimer = setTimeout(async () => {
    suggestions.value = await searchTMDB(newVal)
    showSuggestions.value = suggestions.value.length > 0
  }, 300)
})

const selectSuggestion = async (item: TMDBSuggestion) => {
  isSelectingSuggestion.value = true
  showSuggestions.value = false
  suggestions.value = []
  clearTimeout(debounceTimer)

  formTitle.value = item.title
  formType.value = item.mediaType
  selectedPosterPath.value = item.posterPath
  selectedTmdbId.value = item.id

  if (item.year) {
    formReleaseYear.value = item.year.toString()
  }

  if (item.mediaType === 'show') {
    const details = await getTMDBDetails(item.id, 'show')
    tmdbShowInfo.value = parseTMDBShowInfo(details)
    applyShowProgressFromTmdb()
  } else {
    tmdbShowInfo.value = null
    const details = await getTMDBDetails(item.id, 'movie')
    formRuntimeMinutes.value = details?.runtime ? details.runtime.toString() : ''
    applyCompletedProgress()
  }
}

const handleBlur = () => {
  setTimeout(() => {
    showSuggestions.value = false
  }, 200)
}

const refreshCount = async () => {
  const media = await getAllMedia()
  mediaCount.value = media.length
}

onMounted(() => {
  refreshCount()
  detectImdbActiveTab(true)
  onMediaStorageChange((updatedList) => {
    mediaCount.value = updatedList.length
  })
})

const closeModal = () => {
  isModalOpen.value = false
  formTitle.value = ''
  formUrl.value = ''
  formStatus.value = 'watching'
  formSeason.value = 1
  formEpisode.value = 1
  formMinutes.value = 0
  formRuntimeMinutes.value = ''
  formTotalSeasons.value = ''
  formTotalEpisodes.value = ''
  formReleaseYear.value = ''
  selectedPosterPath.value = undefined
  selectedTmdbId.value = undefined
  tmdbShowInfo.value = null
  suggestions.value = []
  showSuggestions.value = false
  isSelectingSuggestion.value = false
  errorMessage.value = ''
}

const openModal = () => {
  errorMessage.value = ''
  if (isImdbPage.value) {
    detectImdbActiveTab(true)
  } else {
    isModalOpen.value = true
  }
}

const setStatus = (status: MediaStatus) => {
  formStatus.value = status
  if (status === 'completed') {
    applyCompletedProgress()
  }
}

const formatStatus = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const handleNumberWheel = (
  event: WheelEvent,
  current: number | string,
  assign: (value: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
) => {
  if (document.activeElement !== event.currentTarget) return
  event.preventDefault()

  const { min = 0, step = 1 } = opts
  const parsed = typeof current === 'string' ? Number(current) : current
  const base = Number.isFinite(parsed) ? parsed : min
  const delta = event.deltaY < 0 ? step : -step
  let next = base + delta
  if (next < min) next = min
  if (opts.max !== undefined && Number.isFinite(opts.max) && next > opts.max) {
    next = opts.max
  }
  assign(next)
}

const handleAddMediaSubmit = async () => {
  errorMessage.value = ''

  let payload: AddMediaInput

  if (formType.value === 'show') {
    const totalSeasonsNum = Number(formTotalSeasons.value)
    const totalEpisodesNum = Number(formTotalEpisodes.value)

    payload = {
      mediaType: 'show',
      title: formTitle.value,
      status: formStatus.value,
      watchingUrl: formUrl.value,
      currentSeason: formSeason.value,
      currentEpisode: formEpisode.value,
      posterPath: selectedPosterPath.value,
      tmdbId: selectedTmdbId.value,
      ...(formTotalSeasons.value !== '' && !isNaN(totalSeasonsNum)
        ? { totalSeasons: totalSeasonsNum }
        : {}),
      ...(formTotalEpisodes.value !== '' && !isNaN(totalEpisodesNum)
        ? { totalEpisodes: totalEpisodesNum }
        : {}),
    }
  } else {
    const releaseYearNum = Number(formReleaseYear.value)
    const runtimeMinutesNum = Number(formRuntimeMinutes.value)

    payload = {
      mediaType: 'movie',
      title: formTitle.value,
      status: formStatus.value,
      watchingUrl: formUrl.value,
      currentMinutes: formMinutes.value,
      posterPath: selectedPosterPath.value,
      tmdbId: selectedTmdbId.value,
      ...(formRuntimeMinutes.value !== '' && !isNaN(runtimeMinutesNum)
        ? { runtimeMinutes: runtimeMinutesNum }
        : {}),
      ...(formReleaseYear.value !== '' && !isNaN(releaseYearNum)
        ? { releaseYear: releaseYearNum }
        : {})
    }
  }

  try {
    const added = await addMedia(payload)
    if (
      added.mediaType === 'show' &&
      (added.status === 'waiting' || added.status === 'watching') &&
      added.tmdbId
    ) {
      checkShowReleases({ showId: added.id }).catch(() => {})
    }
    closeModal()
  } catch (err) {
    errorMessage.value = (err as Error).message
  }
}
</script>

<template>
  <main class="popup-root" :class="{ 'is-adding': isModalOpen }">
    <header class="navbar">
      <div class="brand">
        <button
          type="button"
          class="title-btn"
          @click="openDashboard"
          title="Open Dashboard"
        >
          <h1>NYATCHING LIST</h1>
        </button>
        <p v-if="!isModalOpen" class="subtitle">List of tv shows and movies currently watching</p>
      </div>

      <div class="header-actions">
        <button
          type="button"
          class="icon-btn"
          @click="openDashboard"
          aria-label="Open Dashboard"
          title="Open Dashboard"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"
            />
          </svg>
        </button>

        <button
          type="button"
          class="icon-btn"
          @click="toggleTheme"
          :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          :title="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
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

    <div class="content">
      <!-- Global/Context Banner for duplicate notification -->
      <div v-if="errorMessage && !isModalOpen" class="error-banner">
        {{ errorMessage }}
      </div>

      <!-- Summary view -->
      <div v-if="!isModalOpen" class="count-card accent">
        <div class="count-display">
          <span class="count-label">Media in Watchlist</span>
          <span class="count-number">{{ mediaCount }}</span>
        </div>
        <button class="primary-btn" @click="openModal">
          {{ isImdbPage ? '+ from IMDb' : '+ Media' }}
        </button>
      </div>

    <!-- Add-media view -->
    <div v-else class="add-panel">
      <div class="add-panel-header">
        <h4>Add Media</h4>
        <button type="button" class="icon-btn" @click="closeModal" aria-label="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              d="M5 5l14 14M19 5L5 19"
            />
          </svg>
        </button>
      </div>

      <!-- Auto-detected IMDb Badge Notification -->
      <div v-if="selectedTmdbId && isImdbPage" class="imdb-auto-badge">
        <span>Detected from IMDb page</span>
      </div>

      <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

      <form @submit.prevent="handleAddMediaSubmit">
        <!-- Title Input with Auto-complete -->
        <div class="form-group autocomplete-group">
          <label for="title-input">Title *</label>
          <input
            id="title-input"
            v-model="formTitle"
            type="text"
            placeholder="e.g. Breaking Bad"
            autocomplete="off"
            required
            @focus="showSuggestions = suggestions.length > 0"
            @blur="handleBlur"
          />

          <!-- Auto-complete Suggestions Dropdown -->
          <div v-if="showSuggestions" class="suggestions-dropdown">
            <div
              v-for="item in suggestions"
              :key="item.id"
              class="suggestion-item"
              @click="selectSuggestion(item)"
            >
              <img
                v-if="item.posterPath"
                :src="item.posterPath"
                class="suggestion-poster"
                alt="poster"
              />
              <div v-else class="suggestion-poster-placeholder"></div>

              <div class="suggestion-info">
                <span class="suggestion-title">{{ item.title }}</span>
                <span class="suggestion-meta">
                  <span class="badge" :class="item.mediaType">{{ item.mediaType }}</span>
                  <span v-if="item.year" class="year">{{ item.year }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label id="type-label">Type</label>
          <div class="segmented" role="group" aria-labelledby="type-label">
            <button
              type="button"
              class="segment-btn"
              :class="{ active: formType === 'show' }"
              @click="formType = 'show'"
            >
              Show
            </button>
            <button
              type="button"
              class="segment-btn"
              :class="{ active: formType === 'movie' }"
              @click="formType = 'movie'"
            >
              Movie
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="url-input">Watching URL (Optional)</label>
          <input
            id="url-input"
            v-model="formUrl"
            type="url"
            placeholder="https://site.com/watch/..."
          />
        </div>

        <div class="form-group dropdown-group">
          <label>Initial Status</label>
          <div class="select">
            <div class="selected">
              <span>{{ formatStatus(formStatus) }}</span>
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
                :class="{ active: formStatus === st }"
                :title="
                  st === 'waiting'
                    ? 'Waiting: notify when a new episode or season is out'
                    : st === 'watching'
                      ? 'Watching: remind you when the next episode or season airs'
                      : undefined
                "
                @click="setStatus(st)"
              >
                {{ formatStatus(st) }}
              </label>
            </div>
          </div>
        </div>

        <div class="field-section">
          <p class="section-label">Progress</p>

          <template v-if="formType === 'show'">
            <div class="form-row">
              <div class="form-group">
                <label for="season-input">Season</label>
                <input
                  id="season-input"
                  v-model.number="formSeason"
                  type="number"
                  min="1"
                  :max="formTotalSeasons ? Number(formTotalSeasons) : undefined"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel($event, formSeason, (n) => (formSeason = n), {
                      min: 1,
                      max: formTotalSeasons ? Number(formTotalSeasons) : undefined,
                    })
                  "
                />
              </div>
              <div class="form-group">
                <label for="episode-input">Episode</label>
                <input
                  id="episode-input"
                  v-model.number="formEpisode"
                  type="number"
                  min="1"
                  :max="formTotalEpisodes ? Number(formTotalEpisodes) : undefined"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel($event, formEpisode, (n) => (formEpisode = n), {
                      min: 1,
                      max: formTotalEpisodes ? Number(formTotalEpisodes) : undefined,
                    })
                  "
                />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="total-seasons-input">Total Seasons (optional)</label>
                <input
                  id="total-seasons-input"
                  v-model="formTotalSeasons"
                  type="number"
                  min="1"
                  placeholder="e.g. 5"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel($event, formTotalSeasons, (n) => (formTotalSeasons = String(n)), {
                      min: 1,
                    })
                  "
                />
              </div>
              <div class="form-group">
                <label for="total-episodes-input">Released Episodes (optional)</label>
                <input
                  id="total-episodes-input"
                  v-model="formTotalEpisodes"
                  type="number"
                  min="1"
                  placeholder="e.g. 10"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel($event, formTotalEpisodes, (n) => (formTotalEpisodes = String(n)), {
                      min: 1,
                    })
                  "
                />
              </div>
            </div>
          </template>

          <template v-else>
            <div class="form-row">
              <div class="form-group">
                <label for="minutes-input">Minutes Watched</label>
                <input
                  id="minutes-input"
                  v-model.number="formMinutes"
                  type="number"
                  min="0"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel($event, formMinutes, (n) => (formMinutes = n), {
                      min: 0,
                      max: formRuntimeMinutes ? Number(formRuntimeMinutes) : undefined,
                      step: 5,
                    })
                  "
                />
              </div>
              <div class="form-group">
                <label for="runtime-minutes-input">Runtime (optional)</label>
                <input
                  id="runtime-minutes-input"
                  v-model="formRuntimeMinutes"
                  type="number"
                  min="1"
                  placeholder="e.g. 120"
                  title="Focus, then scroll to adjust"
                  @wheel.prevent="
                    handleNumberWheel(
                      $event,
                      formRuntimeMinutes,
                      (n) => (formRuntimeMinutes = String(n)),
                      { min: 1, step: 5 },
                    )
                  "
                />
              </div>
            </div>
            <div class="form-group">
              <label for="release-year-input">Release Year (optional)</label>
              <input
                id="release-year-input"
                v-model="formReleaseYear"
                type="number"
                min="1900"
                max="2100"
                placeholder="e.g. 2023"
                title="Focus, then scroll to adjust"
                @wheel.prevent="
                  handleNumberWheel($event, formReleaseYear, (n) => (formReleaseYear = String(n)), {
                    min: 1900,
                    max: 2100,
                  })
                "
              />
            </div>
          </template>
        </div>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" @click="closeModal">
            Cancel
          </button>
          <button type="submit" class="primary-btn">Save Item</button>
        </div>
      </form>
    </div>
    </div>

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
  </main>
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
  --accent-soft: rgba(16, 185, 129, 0.22);
  --error-bg: #4a151b;
  --error-text: #ff8a80;
  --shadow: rgba(0, 0, 0, 0.65);

  --show-text: #38bdf8;
  --movie-text: #f472b6;
  color-scheme: dark;
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
  --accent-soft: rgba(47, 157, 111, 0.16);
  --error-bg: #fbe7e6;
  --error-text: #c0392b;
  --shadow: rgba(0, 0, 0, 0.05);

  --show-text: #004f77;
  --movie-text: #8c1a4d;
  color-scheme: light;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 320px;
  overflow: hidden;
  scrollbar-width: none;
  background: var(--bg);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 16px;
}

html::-webkit-scrollbar,
body::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
</style>

<style scoped>
.popup-root {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 320px;
  min-height: 100%;
  padding: 0;
  background-color: var(--bg);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  transition: background-color 0.15s ease, color 0.15s ease;
  overflow: hidden;
}

.popup-root * {
  box-sizing: border-box;
}

.navbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.85rem;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

.brand {
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.title-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-align: left;
}

.brand h1 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.02em;
  line-height: 1.1;
  transition: color 0.15s ease;
}

.title-btn:hover h1 {
  color: var(--accent-hover);
}

.subtitle {
  color: var(--text-secondary);
  font-size: 0.72rem;
  margin: 0.2rem 0 0 0;
  line-height: 1.3;
}

.icon-btn {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease;
}

.icon-btn:hover {
  border-color: var(--accent);
}

.content {
  padding: 0.75rem 0.85rem 0.1rem;
  flex: 1;
}

.popup-root.is-adding .navbar {
  padding: 0.55rem 0.75rem;
}

.popup-root.is-adding .content {
  flex: none;
  padding: 0.45rem 0.75rem 0;
}

.popup-root.is-adding .site-footer {
  padding: 0.35rem 0 0.45rem;
}

/* ---------- Summary View ---------- */
.count-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem 1.1rem;
  box-shadow: 0 2px 6px var(--shadow);
  transition: border-color 0.15s ease;
}

.count-card:hover {
  border-color: var(--accent);
}

.count-display {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.count-number {
  font-size: 1.85rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  margin-top: 0.2rem;
}

.count-card.accent .count-number {
  color: var(--accent);
}

.count-label {
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.primary-btn,
.secondary-btn {
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.45rem 0.9rem;
  border-radius: 8px;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.primary-btn {
  background-color: var(--accent);
  color: var(--accent-contrast);
  border: 1px solid var(--accent);
}

.primary-btn:hover {
  background-color: var(--accent-hover);
  border-color: var(--accent-hover);
}

.secondary-btn {
  background-color: var(--bg-input);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.secondary-btn:hover {
  background-color: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* ---------- Add-media View ---------- */
.add-panel {
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.55rem 0.7rem 0.6rem;
  box-shadow: 0 2px 8px var(--shadow);
}

.add-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.add-panel-header h4 {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 700;
  color: var(--accent);
}

.add-panel-header .icon-btn {
  width: 1.75rem;
  height: 1.75rem;
}

.imdb-auto-badge {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent);
  padding: 0.28rem 0.5rem;
  border-radius: 8px;
  font-size: 0.68rem;
  font-weight: 600;
  margin-bottom: 0.45rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  margin-bottom: 0.38rem;
}

.dropdown-group {
  position: relative;
  z-index: 50;
}

.form-group label {
  font-size: 0.62rem;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-group input {
  padding: 0.32rem 0.55rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 0.78rem;
  font-family: inherit;
  width: 100%;
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
}

.form-group input[type='number'] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.form-group input[type='number']:focus {
  cursor: ns-resize;
}

.form-group input[type='number']::-webkit-outer-spin-button,
.form-group input[type='number']::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Title Auto-Complete Styling */
.autocomplete-group {
  position: relative;
  z-index: 60;
}

.suggestions-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 14px var(--shadow);
  max-height: 160px;
  overflow-y: auto;
  margin-top: 0.25rem;
  padding: 0.3rem;
}

.suggestion-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.12s ease;
}

.suggestion-item:hover {
  background-color: var(--bg-input);
}

.suggestion-poster {
  width: 22px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.suggestion-poster-placeholder {
  width: 22px;
  height: 32px;
  background: var(--bg-input);
  border: 1px dashed var(--border);
  border-radius: 4px;
  flex-shrink: 0;
}

.suggestion-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  min-width: 0;
}

.suggestion-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggestion-meta {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.suggestion-meta .badge {
  font-size: 0.62rem;
  text-transform: uppercase;
  font-weight: 800;
  letter-spacing: 0.05em;
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
  background: var(--bg-input);
  border: 1px solid var(--border);
}

.suggestion-meta .badge.show {
  color: var(--show-text);
}

.suggestion-meta .badge.movie {
  color: var(--movie-text);
}

.suggestion-meta .year {
  font-size: 0.68rem;
  color: var(--text-muted);
}

/* Custom Interactive Select — matches dashboard */
.select {
  cursor: pointer;
  position: relative;
  color: var(--text-primary);
  width: 100%;
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
  background-color: var(--bg-input);
  border: 1px solid var(--border);
  padding: 0.32rem 0.55rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  left: 0;
  right: 0;
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
  padding: 0.4rem 0.55rem;
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

.form-row {
  display: flex;
  gap: 0.45rem;
  margin-bottom: 0.38rem;
}

.form-row .form-group {
  flex: 1;
  margin-bottom: 0;
}

.field-section {
  padding-top: 0.38rem;
  margin-top: 0.05rem;
  border-top: 1px solid var(--border);
}

.section-label {
  margin: 0 0 0.32rem 0;
  font-size: 0.62rem;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.segmented {
  display: flex;
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.18rem;
  gap: 0.18rem;
  height: 2.05rem;
  box-sizing: border-box;
  align-items: center;
}

.segment-btn {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  height: 100%;
  font-family: inherit;
}

.segment-btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
  margin-top: 0.45rem;
}

.popup-root.is-adding .primary-btn,
.popup-root.is-adding .secondary-btn {
  font-size: 0.75rem;
  padding: 0.35rem 0.75rem;
}

.error-banner {
  background: var(--error-bg);
  color: var(--error-text);
  padding: 0.45rem 0.65rem;
  border-radius: 8px;
  font-size: 0.78rem;
  margin-bottom: 0.65rem;
  text-align: center;
}

.site-footer {
  padding: 0.65rem 0 0.8rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  flex-shrink: 0;
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