<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { MediaStatus, TrackedMedia } from '../types'
import {
  exportBackup,
  getAllMedia,
  getNotificationLog,
  matchesMediaFilter,
  MEDIA_FIELD_GROUPS,
  MediaFieldGroup,
  MediaFilter,
  StatusMode,
} from '../storage'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'exported'): void
}>()

const TYPE_CHOICES: { value: TrackedMedia['mediaType']; label: string }[] = [
  { value: 'show', label: 'Shows' },
  { value: 'movie', label: 'Movies' },
]

const STATUS_MODES: { value: StatusMode; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'only', label: 'Only' },
  { value: 'except', label: 'All except' },
]

const STATUS_CHOICES: { value: MediaStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'next', label: 'Next up' },
  { value: 'completed', label: 'Completed' },
  { value: 'dropped', label: 'Dropped' },
]

const media = ref<TrackedMedia[]>([])
const notificationCount = ref(0)
const exportTitles = ref(true)
const exportTypes = ref(TYPE_CHOICES.map((t) => t.value))
const statusMode = ref<StatusMode>('all')
const exportStatuses = ref<MediaStatus[]>([])
const excludeSome = ref(false)
const excludeFields = ref<MediaFieldGroup[]>([])
const excludedIds = ref<string[]>([])
const exportSettings = ref(true)
const exportNotifications = ref(false)
const backupMessage = ref('')

const mediaFilter = computed<MediaFilter>(() => ({
  types: exportTypes.value,
  statusMode: statusMode.value,
  statuses: statusMode.value === 'all' ? [] : exportStatuses.value,
  excludeFields: excludeSome.value ? excludeFields.value : [],
  excludeIds: excludedIds.value,
}))
// Titles the type and status filters let through, A to Z
const shownTitles = computed(() =>
  media.value
    .filter((item) => matchesMediaFilter(item, mediaFilter.value))
    .sort((a, b) => a.title.localeCompare(b.title))
)
const titleCount = computed(
  () => shownTitles.value.filter((item) => !excludedIds.value.includes(item.id)).length
)
const allShownChecked = computed(() => titleCount.value === shownTitles.value.length)

const toggleAllShown = () => {
  const ids = shownTitles.value.map((item) => item.id)
  excludedIds.value = allShownChecked.value
    ? [...new Set([...excludedIds.value, ...ids])]
    : excludedIds.value.filter((id) => !ids.includes(id))
}

const statusLabel = (status: MediaStatus) =>
  STATUS_CHOICES.find((s) => s.value === status)?.label ?? status
const canExport = computed(
  () =>
    (exportTitles.value || exportSettings.value || exportNotifications.value) &&
    !(exportTitles.value && titleCount.value === 0)
)

onMounted(async () => {
  media.value = await getAllMedia()
  notificationCount.value = (await getNotificationLog()).length
})

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

const downloadJson = (data: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Firefox can cancel the download if the URL is revoked right away
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const handleExport = async () => {
  try {
    const backup = await exportBackup({
      media: exportTitles.value ? mediaFilter.value : null,
      settings: exportSettings.value,
      notifications: exportNotifications.value,
    })
    downloadJson(backup, `nyatching-list-backup-${backup.exportedAt.slice(0, 10)}.json`)
    emit('exported')
  } catch (error) {
    console.error('[Nyatching List] Export failed:', error)
    backupMessage.value = 'Export failed.'
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>Export</h4>
        <button type="button" class="close-btn" aria-label="Close export" @click="emit('close')">
          ✕
        </button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <p class="form-hint">Pick what goes in the JSON file.</p>

          <label class="check-row">
            <input v-model="exportTitles" type="checkbox" />
            <span>Titles</span>
            <span class="check-meta">{{ titleCount }} of {{ media.length }}</span>
          </label>
          <div v-if="exportTitles" class="titles-panel">
            <div class="filter-row">
              <span class="filter-label">Type</span>
              <div class="chips" role="group" aria-label="Types to export">
                <button
                  v-for="t in TYPE_CHOICES"
                  :key="t.value"
                  type="button"
                  class="chip"
                  :class="{ active: exportTypes.includes(t.value) }"
                  :aria-pressed="exportTypes.includes(t.value)"
                  @click="exportTypes = toggle(exportTypes, t.value)"
                >
                  {{ t.label }}
                </button>
              </div>
            </div>

            <div class="filter-row">
              <span class="filter-label">Status</span>
              <div class="filter-stack">
                <div class="chips" role="group" aria-label="Which statuses to export">
                  <button
                    v-for="m in STATUS_MODES"
                    :key="m.value"
                    type="button"
                    class="chip"
                    :class="{ active: statusMode === m.value }"
                    :aria-pressed="statusMode === m.value"
                    @click="statusMode = m.value"
                  >
                    {{ m.label }}
                  </button>
                </div>
                <div v-if="statusMode !== 'all'" class="pick-list" role="group" aria-label="Statuses">
                  <label v-for="s in STATUS_CHOICES" :key="s.value" class="pick-row">
                    <input
                      type="checkbox"
                      :checked="exportStatuses.includes(s.value)"
                      @change="exportStatuses = toggle(exportStatuses, s.value)"
                    />
                    <span>{{ s.label }}</span>
                  </label>
                </div>
              </div>
            </div>

            <div class="filter-row">
              <span class="filter-label">Fields</span>
              <div class="filter-stack">
                <div class="chips" role="group" aria-label="Which fields to export">
                  <button
                    type="button"
                    class="chip"
                    :class="{ active: !excludeSome }"
                    :aria-pressed="!excludeSome"
                    @click="excludeSome = false"
                  >
                    All fields
                  </button>
                  <button
                    type="button"
                    class="chip"
                    :class="{ active: excludeSome }"
                    :aria-pressed="excludeSome"
                    @click="excludeSome = true"
                  >
                    Exclude some
                  </button>
                </div>
                <template v-if="excludeSome">
                  <div class="pick-list" role="group" aria-label="Fields to leave out">
                    <label v-for="g in MEDIA_FIELD_GROUPS" :key="g.key" class="pick-row pick-row-stacked">
                      <input
                        type="checkbox"
                        :checked="excludeFields.includes(g.key)"
                        @change="excludeFields = toggle(excludeFields, g.key)"
                      />
                      <span class="pick-text">
                        {{ g.label }}
                        <small class="form-hint">{{ g.hint }}</small>
                      </span>
                    </label>
                  </div>
                  <p class="form-hint">
                    Checked fields are left out. Name, type, status and dates are always kept.
                  </p>
                </template>
              </div>
            </div>

            <div v-if="shownTitles.length" class="title-list">
              <label class="pick-row pick-row-all">
                <input
                  type="checkbox"
                  :checked="allShownChecked"
                  :indeterminate="titleCount > 0 && !allShownChecked"
                  @change="toggleAllShown"
                />
                <span>Select all</span>
                <span class="check-meta">{{ titleCount }} selected</span>
              </label>
              <div class="title-scroll">
                <label v-for="item in shownTitles" :key="item.id" class="pick-row">
                  <input
                    type="checkbox"
                    :checked="!excludedIds.includes(item.id)"
                    @change="excludedIds = toggle(excludedIds, item.id)"
                  />
                  <span class="pick-title">{{ item.title }}</span>
                  <span class="check-meta">{{ item.mediaType }} · {{ statusLabel(item.status) }}</span>
                </label>
              </div>
            </div>
            <p v-else class="form-hint">No titles match these filters.</p>
          </div>

          <label class="check-row">
            <input v-model="exportSettings" type="checkbox" />
            <span>Settings</span>
            <span class="check-meta">intervals, theme</span>
          </label>

          <label class="check-row">
            <input v-model="exportNotifications" type="checkbox" />
            <span>Notification history</span>
            <span class="check-meta">{{ notificationCount }}</span>
          </label>
        </div>

        <p v-if="backupMessage" class="form-hint backup-message" role="status">
          {{ backupMessage }}
        </p>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button type="button" class="primary-btn" :disabled="!canExport" @click="handleExport">
          Export JSON
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
  backdrop-filter: none;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.modal-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.25rem 1.4rem;
  width: 420px;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  color: var(--text-primary);
  box-shadow: 0 8px 24px var(--shadow);
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
  border-radius: 4px;
  transition: color 0.15s ease;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.form-hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
}

.form-group .check-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: var(--font-sans);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}

.check-row input,
.pick-row input {
  flex-shrink: 0;
  accent-color: var(--accent);
  width: 1rem;
  height: 1rem;
  margin: 0;
  cursor: pointer;
}

.check-meta {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
}

.titles-panel {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 0.35rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
}

.filter-row {
  display: grid;
  grid-template-columns: 3.4rem 1fr;
  gap: 0.5rem;
  align-items: start;
}

.filter-label {
  padding-top: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-muted);
}

.filter-stack {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.title-list {
  border-top: 1px solid var(--border);
  padding-top: 0.4rem;
}

.title-scroll {
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.form-group .pick-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.35rem 0.4rem;
  font-family: var(--font-sans);
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--text-primary);
  letter-spacing: 0;
  cursor: pointer;
}

.form-group .pick-row:hover {
  background: var(--bg-input);
}

.form-group .pick-row-stacked {
  align-items: flex-start;
}

.pick-row-stacked input {
  margin-top: 0.1rem;
}

.pick-text {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.form-group .pick-row-all {
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0.25rem;
}

.pick-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  border-radius: 999px;
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
  border-radius: 8px;
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
  border-color: var(--accent-hover);
}

.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.secondary-btn {
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.secondary-btn:hover {
  background-color: transparent;
  color: var(--text-primary);
}

.primary-btn:active,
.secondary-btn:active {
  transform: scale(0.98);
}
</style>
