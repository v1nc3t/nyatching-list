<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { MediaStatus, TrackedMedia } from '../types'
import {
  exportBackup,
  getAllMedia,
  getNotificationLog,
  matchesMediaFilter,
  MEDIA_FIELD_GROUPS,
  Backup,
  MediaFieldGroup,
  MediaFilter,
  StatusMode,
} from '../storage'

const emit = defineEmits<{
  (e: 'close'): void
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
const exportSettings = ref(true)
const exportNotifications = ref(false)
const backupMessage = ref('')

const mediaFilter = computed<MediaFilter>(() => ({
  types: exportTypes.value,
  statusMode: statusMode.value,
  statuses: statusMode.value === 'all' ? [] : exportStatuses.value,
  excludeFields: excludeSome.value ? excludeFields.value : [],
}))
const titleCount = computed(
  () => media.value.filter((item) => matchesMediaFilter(item, mediaFilter.value)).length
)
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const describeExport = (backup: Backup): string =>
  [
    backup.media && plural(backup.media.length, 'title'),
    backup.settings && 'settings',
    backup.notifications && plural(backup.notifications.length, 'notification'),
  ]
    .filter(Boolean)
    .join(', ')

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
    backupMessage.value = `Exported ${describeExport(backup)}.`
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
          <div v-if="exportTitles" class="chip-rows">
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
            <div v-if="statusMode !== 'all'" class="chips" role="group" aria-label="Statuses">
              <button
                v-for="s in STATUS_CHOICES"
                :key="s.value"
                type="button"
                class="chip"
                :class="{ active: exportStatuses.includes(s.value) }"
                :aria-pressed="exportStatuses.includes(s.value)"
                @click="exportStatuses = toggle(exportStatuses, s.value)"
              >
                {{ s.label }}
              </button>
            </div>

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
              <div class="chips" role="group" aria-label="Fields to leave out">
                <button
                  v-for="g in MEDIA_FIELD_GROUPS"
                  :key="g.key"
                  type="button"
                  class="chip"
                  :class="{ active: excludeFields.includes(g.key) }"
                  :aria-pressed="excludeFields.includes(g.key)"
                  :title="g.hint"
                  @click="excludeFields = toggle(excludeFields, g.key)"
                >
                  {{ g.label }}
                </button>
              </div>
              <p class="form-hint">Name, type, status and dates are always kept.</p>
            </template>
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
  width: 380px;
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

.check-row input {
  accent-color: var(--accent);
  width: 1rem;
  height: 1rem;
  margin: 0;
  cursor: pointer;
}

.check-meta {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
}

.chip-rows {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-left: 1.55rem;
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
