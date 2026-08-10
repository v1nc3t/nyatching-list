<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { MediaStatus } from '../types'
import { getAllMedia, addMedia, onMediaStorageChange, AddMediaInput } from '../storage'

// Theme
type Theme = 'light' | 'dark'
const THEME_KEY = 'nyatching-theme'

const getInitialTheme = (): Theme => {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

const theme = ref<Theme>(getInitialTheme())

const applyThemeToDocument = (t: Theme) => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('theme-dark', t === 'dark')
  document.documentElement.classList.toggle('theme-light', t === 'light')
}

applyThemeToDocument(theme.value)

watch(theme, (t) => {
  applyThemeToDocument(t)
  localStorage.setItem(THEME_KEY, t)
})

const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

// Open Dashboard Handler
const openDashboard = () => {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    chrome.runtime.openOptionsPage()
  } else if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
    window.open(chrome.runtime.getURL('src/dashboard/dashboard.html'))
  }
}

// State
const mediaCount = ref(0)
const isModalOpen = ref(false)
const errorMessage = ref('')
const githubLink = ref('https://github.com/v1nc3t/nyatching-list')

// Form State for Manual Add
const formType = ref<'show' | 'movie'>('show')
const formTitle = ref('')
const formUrl = ref('')
const formStatus = ref<MediaStatus>('watching')
const formSeason = ref(1)
const formEpisode = ref(1)
const formMinutes = ref(0)
const formRuntimeMinutes = ref('')
const formTotalSeasons = ref('')
const formReleaseYear = ref('')

// Load Data
const refreshCount = async () => {
  const media = await getAllMedia()
  mediaCount.value = media.length
}

onMounted(() => {
  refreshCount()
  onMediaStorageChange((updatedList) => {
    mediaCount.value = updatedList.length
  })
})

const closeModal = () => {
  isModalOpen.value = false
  formTitle.value = ''
  formUrl.value = ''
  formSeason.value = 1
  formEpisode.value = 1
  formMinutes.value = 0
  formRuntimeMinutes.value = ''
  formTotalSeasons.value = ''
  formReleaseYear.value = ''
  errorMessage.value = ''
}

// Modal Handlers
const openModal = () => {
  errorMessage.value = ''
  isModalOpen.value = true
}

const handleAddMediaSubmit = async () => {
  errorMessage.value = ''

  let payload: AddMediaInput

  if (formType.value === 'show') {
    const totalSeasonsNum = Number(formTotalSeasons.value)

    payload = {
      mediaType: 'show',
      title: formTitle.value,
      status: formStatus.value,
      watchingUrl: formUrl.value,
      currentSeason: formSeason.value,
      currentEpisode: formEpisode.value,
      ...(formTotalSeasons.value !== '' && !isNaN(totalSeasonsNum)
        ? { totalSeasons: totalSeasonsNum }
        : {})
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
      ...(formRuntimeMinutes.value !== '' && !isNaN(runtimeMinutesNum)
        ? { runtimeMinutes: runtimeMinutesNum }
        : {}),
      ...(formReleaseYear.value !== '' && !isNaN(releaseYearNum)
        ? { releaseYear: releaseYearNum }
        : {})
    }
  }

  try {
    await addMedia(payload)
    closeModal()
  } catch (err) {
    errorMessage.value = (err as Error).message
  }
}
</script>

<template>
  <main>
    <div class="header-row">
      <div class="header-text">
        <button
          type="button"
          class="title-btn"
          @click="openDashboard"
          title="Open Dashboard"
        >
          <h3>Nyatching list</h3>
        </button>
        <p>List of tv shows and movies currently watching</p>
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
    </div>

    <!-- Summary view -->
    <div v-if="!isModalOpen" class="count-card">
      <div class="count-display">
        <span class="count-number">{{ mediaCount }}</span>
        <span class="count-label">Items in Watchlist</span>
      </div>
      <button class="primary-btn" @click="openModal">+ Add Item</button>
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

      <div v-if="errorMessage" class="error-banner">{{ errorMessage }}</div>

      <form @submit.prevent="handleAddMediaSubmit">
        <div class="form-group">
          <label id="type-label">Type</label>
          <div class="segmented" role="group" aria-labelledby="type-label">
            <label class="segment">
              <input v-model="formType" type="radio" value="show" />
              <span>TV Show</span>
            </label>
            <label class="segment">
              <input v-model="formType" type="radio" value="movie" />
              <span>Movie</span>
            </label>
          </div>
        </div>

        <div class="form-group">
          <label for="title-input">Title *</label>
          <input
            id="title-input"
            v-model="formTitle"
            type="text"
            placeholder="e.g. Breaking Bad"
            required
          />
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

        <div class="form-group">
          <label for="status-select">Initial Status</label>
          <select id="status-select" v-model="formStatus">
            <option value="watching">Watching</option>
            <option value="waiting">Waiting</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
        </div>

        <div class="field-section">
          <p class="section-label">Progress</p>

          <template v-if="formType === 'show'">
            <div class="form-row">
              <div class="form-group">
                <label for="season-input">Season</label>
                <input id="season-input" v-model.number="formSeason" type="number" min="1" />
              </div>
              <div class="form-group">
                <label for="episode-input">Episode</label>
                <input id="episode-input" v-model.number="formEpisode" type="number" min="1" />
              </div>
            </div>
            <div class="form-group">
              <label for="total-seasons-input">Total Seasons (optional)</label>
              <input
                id="total-seasons-input"
                v-model="formTotalSeasons"
                type="number"
                min="1"
                placeholder="e.g. 5"
              />
            </div>
          </template>

          <template v-else>
            <div class="form-row">
              <div class="form-group">
                <label for="minutes-input">Minutes Watched</label>
                <input id="minutes-input" v-model.number="formMinutes" type="number" min="0" />
              </div>
              <div class="form-group">
                <label for="runtime-minutes-input">Runtime (mins, optional)</label>
                <input
                  id="runtime-minutes-input"
                  v-model="formRuntimeMinutes"
                  type="number"
                  min="1"
                  placeholder="e.g. 120"
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

    <!-- Footer GitHub Link -->
    <footer>
      <a :href="githubLink" target="_blank" rel="noopener noreferrer">
        created by v1nc3t
      </a>
    </footer>
  </main>
</template>

<style>
:root.theme-dark {
  --bg: #242424;
  --bg-card: #2a2a2a;
  --bg-input: #1a1a1a;
  --border: #333333;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --text-muted: #888888;
  --accent: #42b983;
  --accent-hover: #369b6e;
  --accent-contrast: #1a1a1a;
  --accent-soft: rgba(66, 185, 131, 0.22);
  --error-bg: #4a151b;
  --error-text: #ff8a80;
  --shadow: rgba(0, 0, 0, 0.5);
  color-scheme: dark;
}

:root.theme-light {
  --bg: #f6f6f7;
  --bg-card: #ffffff;
  --bg-input: #ffffff;
  --border: #dcdcdc;
  --text-primary: #1c1c1c;
  --text-secondary: #555555;
  --text-muted: #767676;
  --accent: #2f9d6f;
  --accent-hover: #26855d;
  --accent-contrast: #ffffff;
  --accent-soft: rgba(47, 157, 111, 0.16);
  --error-bg: #fbe7e6;
  --error-text: #c0392b;
  --shadow: rgba(0, 0, 0, 0.12);
  color-scheme: light;
}

html,
body {
  margin: 0;
  padding: 0;
  width: max-content;
  height: max-content;
  overflow: hidden;
  background: var(--bg);
  color: var(--text-primary);
}
</style>

<style scoped>
main {
  display: block;
  text-align: center;
  box-sizing: border-box;
  width: 320px;
  padding: 0.85rem;
  background-color: var(--bg);
  color: var(--text-primary);
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    sans-serif;
  transition: background-color 0.15s ease, color 0.15s ease;
}

main * {
  box-sizing: border-box;
}

.header-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
  text-align: left;
}

.header-text {
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
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

h3 {
  color: var(--accent);
  text-transform: uppercase;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  line-height: 1.2;
  margin: 0 0 0.15rem 0;
  transition: color 0.15s ease, transform 0.15s ease;
}

.title-btn:hover h3 {
  color: var(--accent-hover);
}

p {
  color: var(--text-secondary);
  font-size: 0.78rem;
  margin: 0 0 0.75rem 0;
}

.icon-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
  padding: 0;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.icon-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ---------- Summary view ---------- */
.count-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.85rem 1rem;
  margin-bottom: 0.75rem;
  box-shadow: 0 1px 3px var(--shadow);
}

.count-display {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.count-number {
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
}

.count-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-top: 0.2rem;
}

.primary-btn {
  font-size: 0.8rem;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.primary-btn:hover {
  background-color: var(--accent-hover);
  border-color: var(--accent-hover);
}

.secondary-btn {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  padding: 0.45rem 0.75rem;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.secondary-btn:hover {
  color: var(--text-primary);
  background-color: var(--bg-input);
}

/* ---------- Add-media view ---------- */
.add-panel {
  width: 100%;
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  box-shadow: 0 1px 3px var(--shadow);
}

.add-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.add-panel-header h4 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--accent);
}

.add-panel-header .icon-btn {
  width: 1.5rem;
  height: 1.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.45rem;
}

.form-group label {
  font-size: 0.65rem;
  color: var(--text-secondary);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.form-group input,
.form-group select {
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
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

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.form-group select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='12' height='12'%3E%3Cpath fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  padding-right: 1.5rem;
  cursor: pointer;
}

.form-row {
  display: flex;
  gap: 0.4rem;
}

.form-row .form-group {
  flex: 1;
  margin-bottom: 0;
}

.field-section {
  padding-top: 0.35rem;
  margin-top: 0.35rem;
  border-top: 1px solid var(--border);
}

.section-label {
  margin: 0 0 0.35rem 0;
  font-size: 0.6rem;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.segmented {
  display: inline-flex;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0.15rem;
  gap: 0.1rem;
}

.segment {
  position: relative;
  margin: 0;
  border-radius: 999px;
}

.segment input {
  position: absolute;
  inset: 0;
  opacity: 0;
  margin: 0;
  cursor: pointer;
}

.segment span {
  display: block;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}

.segment input:checked + span {
  background: var(--accent);
  color: var(--accent-contrast);
  font-weight: 700;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.5rem;
}

.error-banner {
  background: var(--error-bg);
  color: var(--error-text);
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  font-size: 0.72rem;
  margin-bottom: 0.45rem;
}

footer {
  margin-top: 0.4rem;
}

a {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-decoration: none;
}

a:hover {
  color: var(--accent);
}
</style>