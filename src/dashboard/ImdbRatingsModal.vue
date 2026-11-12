<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { MediaStatus } from '../types'
import { getAllMedia, mergeMedia } from '../storage'
import { fetchTmdbByImdbId, TMDBExternalFindResult } from '../services/tmdb'
import { parseImdbRatings, imdbToMedia, ImdbRow } from '../services/imdb'
import StatusSelect from './StatusSelect.vue'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'imported'): void
}>()

type GroupKey = 'movie' | 'ended' | 'ongoing'

interface Item {
  row: ImdbRow
  tmdb: TMDBExternalFindResult | null
  group: GroupKey
  checked: boolean
  status: MediaStatus
  /** Already tracked: shown but never imported, so progress and links are not overwritten. */
  inList: boolean
}

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: 'movie', label: 'Movies' },
  { key: 'ended', label: 'Ended shows' },
  { key: 'ongoing', label: 'Ongoing shows' },
]
// A rating means you watched it
const DEFAULT_STATUS: MediaStatus = 'completed'
// shortcut: fixed pool, no retry on TMDB rate limits (a miss shows as "no TMDB match"); add backoff if big files miss often
const LOOKUPS_AT_ONCE = 5

const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const items = ref<Item[]>([])
const skipped = ref(0)
const lookedUp = ref(0)
const lookupTotal = ref(0)
const isLookingUp = ref(false)
const isImporting = ref(false)
const message = ref('')
const ongoingMode = ref<'all' | 'each'>('all')
const ongoingStatus = ref<MediaStatus>(DEFAULT_STATUS)
const openGroups = ref<GroupKey[]>([])

const toggleOpen = (key: GroupKey) => {
  openGroups.value = openGroups.value.includes(key)
    ? openGroups.value.filter((k) => k !== key)
    : [...openGroups.value, key]
}

let cancelled = false
onUnmounted(() => {
  cancelled = true
})

const groups = computed(() =>
  GROUPS.map((g) => {
    const list = items.value.filter((item) => item.group === g.key)
    return {
      ...g,
      list,
      checked: list.filter((item) => item.checked).length,
      selectable: list.filter((item) => !item.inList).length,
    }
  }).filter((g) => g.list.length)
)
const selectedCount = computed(() => items.value.filter((item) => item.checked).length)
const inListCount = computed(() => items.value.filter((item) => item.inList).length)
const summary = computed(() =>
  [
    `${items.value.length - inListCount.value} new`,
    inListCount.value && `${inListCount.value} already in your list`,
    skipped.value && `${skipped.value} skipped (episodes and other rows)`,
  ]
    .filter(Boolean)
    .join(' · ')
)

const usesOneStatus = (key: GroupKey) => key === 'ongoing' && ongoingMode.value === 'all'
const statusFor = (item: Item) => (usesOneStatus(item.group) ? ongoingStatus.value : item.status)

// Per title starts from the status picked for all
const setPerTitle = () => {
  if (ongoingMode.value === 'all') {
    for (const item of items.value) if (item.group === 'ongoing') item.status = ongoingStatus.value
  }
  ongoingMode.value = 'each'
  if (!openGroups.value.includes('ongoing')) toggleOpen('ongoing')
}

const setGroupChecked = (key: GroupKey, checked: boolean) => {
  for (const item of items.value) if (item.group === key && !item.inList) item.checked = checked
}

const lookUp = async (rows: ImdbRow[]): Promise<Item[]> => {
  const existing = await getAllMedia()
  const found: Item[] = []
  let next = 0
  const worker = async () => {
    while (next < rows.length && !cancelled) {
      const row = rows[next++]
      const tmdb = await fetchTmdbByImdbId(row.imdbId)
      // TMDB's type wins so the stored tmdbId points at the right endpoint
      if (tmdb) row.mediaType = tmdb.mediaType
      lookedUp.value++
      // Same rules as adding a title, plus the ids an earlier import would have given it
      const titles = [row.title, tmdb?.title].map((t) => t?.toLowerCase())
      const ids = [tmdb && `tmdb-${row.mediaType}-${tmdb.tmdbId}`, `imdb-${row.imdbId}`]
      const inList = existing.some(
        (m) =>
          (tmdb && m.tmdbId === tmdb.tmdbId && m.mediaType === row.mediaType) ||
          ids.includes(m.id) ||
          titles.includes(m.title.toLowerCase()) ||
          m.watchingUrl?.match(/tt\d+/)?.[0] === row.imdbId
      )
      const group: GroupKey =
        row.mediaType === 'movie' ? 'movie' : tmdb?.showInfo?.ended ? 'ended' : 'ongoing'
      found.push({ row, tmdb, group, checked: !inList, status: DEFAULT_STATUS, inList })
    }
  }
  await Promise.all(Array.from({ length: LOOKUPS_AT_ONCE }, worker))
  return found.sort((a, b) => a.row.title.localeCompare(b.row.title))
}

const handleFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  items.value = []
  message.value = ''
  let rows: ImdbRow[]
  try {
    const parsed = parseImdbRatings(await file.text())
    rows = parsed.rows
    skipped.value = parsed.skipped
  } catch (error) {
    fileName.value = ''
    message.value = (error as Error).message
    return
  }

  fileName.value = file.name
  lookedUp.value = 0
  lookupTotal.value = rows.length
  isLookingUp.value = true
  try {
    items.value = await lookUp(rows)
  } catch (error) {
    console.error('[Nyatching List] IMDb lookup failed:', error)
    message.value = 'Could not read your list. Try again.'
  } finally {
    isLookingUp.value = false
  }
}

const handleImport = async () => {
  isImporting.value = true
  message.value = ''
  try {
    const now = Date.now()
    await mergeMedia(
      items.value
        .filter((item) => item.checked)
        .map((item) => imdbToMedia(item.row, item.tmdb, statusFor(item), now))
    )
    emit('imported')
  } catch (error) {
    console.error('[Nyatching List] IMDb import failed:', error)
    message.value = (error as Error).message
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>IMDb ratings</h4>
        <button type="button" class="close-btn" aria-label="Close IMDb ratings" @click="emit('close')">
          ✕
        </button>
      </div>

      <div class="modal-body">
        <div class="file-group">
          <p class="form-hint">Choose the ratings CSV you exported from IMDb.</p>
          <div class="file-row">
            <button
              type="button"
              class="secondary-btn"
              :disabled="isLookingUp || isImporting"
              @click="fileInput?.click()"
            >
              Choose file
            </button>
            <span v-if="fileName" class="file-name">{{ fileName }}</span>
            <input ref="fileInput" type="file" accept=".csv,text/csv" hidden @change="handleFile" />
          </div>
        </div>

        <div v-if="isLookingUp" class="lookup" role="status">
          <div class="lookup-head">
            <span class="spinner" aria-hidden="true" />
            <span>Looking up titles on TMDB</span>
            <span class="check-meta">{{ lookedUp }} / {{ lookupTotal }}</span>
          </div>
          <div
            class="lookup-track"
            role="progressbar"
            aria-label="Titles looked up"
            :aria-valuenow="lookedUp"
            :aria-valuemax="lookupTotal"
          >
            <div class="lookup-fill" :style="{ width: `${(lookedUp / lookupTotal) * 100}%` }" />
          </div>
          <p class="form-hint">Big files take a minute.</p>
        </div>

        <template v-else-if="fileName">
          <p class="form-hint">{{ summary }}</p>

          <section v-for="g in groups" :key="g.key" class="group" :aria-label="g.label">
            <div class="pick-row pick-row-all" :class="{ 'is-open': openGroups.includes(g.key) }">
              <input
                type="checkbox"
                :aria-label="`Select all ${g.label}`"
                :disabled="!g.selectable"
                :checked="!!g.selectable && g.checked === g.selectable"
                :indeterminate="g.checked > 0 && g.checked < g.selectable"
                @change="setGroupChecked(g.key, g.checked < g.selectable)"
              />
              <button
                type="button"
                class="group-toggle"
                :aria-expanded="openGroups.includes(g.key)"
                @click="toggleOpen(g.key)"
              >
                <span>{{ g.label }}</span>
                <span class="check-meta">{{ g.checked }} of {{ g.selectable }}</span>
                <svg viewBox="0 0 512 512" class="arrow" aria-hidden="true">
                  <path
                    d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
                  />
                </svg>
              </button>
            </div>

            <div v-if="g.key === 'ongoing'" class="ongoing-status">
              <div class="chips" role="group" aria-label="How to set ongoing show statuses">
                <button
                  type="button"
                  class="chip"
                  :class="{ active: ongoingMode === 'all' }"
                  :aria-pressed="ongoingMode === 'all'"
                  @click="ongoingMode = 'all'"
                >
                  One status for all
                </button>
                <button
                  type="button"
                  class="chip"
                  :class="{ active: ongoingMode === 'each' }"
                  :aria-pressed="ongoingMode === 'each'"
                  @click="setPerTitle"
                >
                  Per title
                </button>
              </div>
              <StatusSelect
                v-if="ongoingMode === 'all'"
                v-model="ongoingStatus"
                label="Status for all ongoing shows"
              />
            </div>

            <div v-if="openGroups.includes(g.key)" class="pick-scroll">
              <div
                v-for="item in g.list"
                :key="item.row.imdbId"
                class="pick-row"
                :class="{ 'is-in-list': item.inList }"
              >
                <label class="pick-main">
                  <input v-model="item.checked" type="checkbox" :disabled="item.inList" />
                  <span class="pick-text">
                    <span class="pick-title">{{ item.row.title }}</span>
                    <small v-if="item.inList" class="form-hint">Already in your list</small>
                    <small v-else-if="!item.tmdb" class="form-hint">No TMDB match</small>
                  </span>
                </label>
                <StatusSelect
                  v-if="!usesOneStatus(g.key) && !item.inList"
                  v-model="item.status"
                  :label="`Status for ${item.row.title}`"
                />
              </div>
            </div>
          </section>
        </template>

        <p v-if="message" class="form-hint backup-message" role="status">{{ message }}</p>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button
          type="button"
          class="primary-btn"
          :disabled="!selectedCount || isLookingUp || isImporting"
          @click="handleImport"
        >
          {{ isImporting ? 'Importing…' : `Import ${selectedCount}` }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.modal-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 1.25rem 1.4rem;
  width: 480px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  color: var(--text-primary);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.2rem;
}

.modal-header h4 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--accent);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.2rem;
  line-height: 1;
  transition: color 0.15s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.file-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.lookup {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.85rem 0.9rem;
  border: 1px solid var(--border);
}

.lookup-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.85rem;
  font-weight: 600;
}

.spinner {
  flex-shrink: 0;
  width: 0.85rem;
  height: 0.85rem;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50% !important;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.lookup-track {
  height: 4px;
  background: var(--bg-input);
  overflow: hidden;
}

.lookup-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}

.form-hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-muted);
  font-weight: 500;
}

.group {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  padding: 0.4rem 0.6rem;
}

.ongoing-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.3rem 0.4rem 0.5rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 0.25rem 0.7rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}

.chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
  font-weight: 600;
}

.pick-scroll {
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.pick-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.4rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
}

.pick-row:hover {
  background: var(--bg-input);
}

.pick-row.is-in-list {
  opacity: 0.55;
}

.pick-row.is-in-list .pick-main,
.pick-row input:disabled {
  cursor: default;
}

.pick-row-all {
  font-weight: 600;
}

.pick-row-all.is-open {
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.25rem;
}

.group-toggle {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
  padding: 0;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.arrow {
  flex-shrink: 0;
  width: 12px;
  height: 10px;
  fill: currentColor;
  transform: rotate(-90deg);
  transition: transform 200ms ease;
}

.is-open .arrow {
  transform: rotate(0deg);
}

.pick-main {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.pick-row input {
  flex-shrink: 0;
  accent-color: var(--accent);
  width: 1rem;
  height: 1rem;
  margin: 0;
  cursor: pointer;
}

.pick-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  min-width: 0;
}

.pick-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.check-meta {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
}

.backup-message {
  color: var(--text-secondary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-top: 1.4rem;
}

.primary-btn,
.secondary-btn {
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.55rem 1.1rem;
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

.primary-btn {
  background-color: var(--accent);
  color: var(--accent-contrast);
  border: none;
}

.primary-btn:hover {
  background-color: var(--accent-hover);
}

.primary-btn:disabled,
.secondary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.primary-btn:active,
.secondary-btn:active {
  transform: scale(0.98);
}
</style>
