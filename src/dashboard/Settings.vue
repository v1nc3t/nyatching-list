<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import browser from 'webextension-polyfill'
import { AppSettings, MediaStatus, TrackedMedia } from '../types'
import {
  exportBackup,
  getAllMedia,
  getNotificationLog,
  getSettings,
  importBackup,
  matchesMediaFilter,
  saveSettings,
  Backup,
  ImportResult,
} from '../storage'
import { scheduleReleaseCheckAlarm } from '../background/alarm-schedule'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const isSaving = ref(false)
const openMenu = ref<'episode' | 'reminder' | null>(null)

const settings = ref<AppSettings>({
  newSeasonCheckIntervalHours: 24,
  reminderIntervalHours: 168,
})

const intervalOptions = [
  { label: 'Never', value: -1 },
  { label: '1 Day', value: 24 },
  { label: '2 Days', value: 48 },
  { label: '1 Week', value: 168 },
  { label: '2 Weeks', value: 336 },
  { label: '1 Month', value: 720 },
  { label: '2 Months', value: 1440 },
  { label: '6 Months', value: 4320 },
  { label: '1 Year', value: 8760 },
]

const intervalLabel = (value: number) =>
  intervalOptions.find((opt) => opt.value === value)?.label ?? 'Select interval'

const settingFields = computed(() => [
  {
    key: 'episode' as const,
    label: 'New episodes',
    hint: 'A waiting show with a new episode / season moves to watching, and notifies if Notify is on. A next up show notifies once when it starts airing. Never turns this off.',
    value: settings.value.newSeasonCheckIntervalHours,
  },
  {
    key: 'reminder' as const,
    label: 'Reminders',
    hint: 'Notifies when the set time passes since you updated a watching title.',
    value: settings.value.reminderIntervalHours,
  },
])

const handleClickOutside = (event: MouseEvent) => {
  if (!(event.target as HTMLElement).closest('.select')) openMenu.value = null
}

onMounted(async () => {
  document.addEventListener('click', handleClickOutside)
  settings.value = await getSettings()
  await loadBackupCounts()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const selectInterval = (key: 'episode' | 'reminder', val: number) => {
  if (key === 'episode') settings.value.newSeasonCheckIntervalHours = val
  else settings.value.reminderIntervalHours = val
  openMenu.value = null
}

// ---------- Backup ----------

const TYPE_CHOICES: { value: TrackedMedia['mediaType']; label: string }[] = [
  { value: 'show', label: 'Shows' },
  { value: 'movie', label: 'Movies' },
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
const exportStatuses = ref(STATUS_CHOICES.map((s) => s.value))
const exportSettings = ref(true)
const exportNotifications = ref(false)
const backupMessage = ref('')
const importInput = ref<HTMLInputElement | null>(null)

const mediaFilter = computed(() => ({ types: exportTypes.value, statuses: exportStatuses.value }))
const titleCount = computed(
  () => media.value.filter((item) => matchesMediaFilter(item, mediaFilter.value)).length
)
const canExport = computed(
  () => exportTitles.value || exportSettings.value || exportNotifications.value
)

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const loadBackupCounts = async () => {
  media.value = await getAllMedia()
  notificationCount.value = (await getNotificationLog()).length
}

const describeExport = (backup: Backup): string =>
  [
    backup.media && plural(backup.media.length, 'title'),
    backup.settings && 'settings',
    backup.notifications && plural(backup.notifications.length, 'notification'),
  ]
    .filter(Boolean)
    .join(', ')

const describeImport = (result: ImportResult): string => {
  const parts: string[] = []
  if (result.media) {
    const { added, updated, skipped } = result.media
    parts.push(
      `${plural(added, 'title')} added, ${updated} updated` + (skipped ? `, ${skipped} skipped` : '')
    )
  }
  if (result.settings) parts.push('settings applied')
  if (result.notificationsAdded !== undefined) {
    parts.push(`${plural(result.notificationsAdded, 'notification')} added`)
  }
  return parts.join(', ')
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
    backupMessage.value = `Exported ${describeExport(backup)}.`
  } catch (error) {
    console.error('[Nyatching List] Export failed:', error)
    backupMessage.value = 'Export failed.'
  }
}

const handleImportFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const result = await importBackup(await file.text())
    if (result.settings) {
      settings.value = result.settings
      await notifyBackground(result.settings)
    }
    await loadBackupCounts()
    backupMessage.value = `Imported: ${describeImport(result)}.`
  } catch (error) {
    backupMessage.value = (error as Error).message
  }
}

// ---------- Save ----------

const notifyBackground = async (saved: AppSettings) => {
  try {
    await browser.runtime.sendMessage({
      type: 'SETTINGS_UPDATED',
      settings: saved,
    })
  } catch (error) {
    console.error('[Nyatching List] Background did not acknowledge settings:', error)
    await scheduleReleaseCheckAlarm(saved)
  }
}

const handleSave = async () => {
  isSaving.value = true
  try {
    const saved = await saveSettings({ ...settings.value })
    await notifyBackground(saved)
    emit('close')
  } catch (error) {
    console.error('[Nyatching List] Failed to save settings:', error)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>Settings</h4>
        <button type="button" class="close-btn" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <div v-for="field in settingFields" :key="field.key" class="form-group">
          <label>{{ field.label }}</label>
          <p class="form-hint">{{ field.hint }}</p>
          <div class="select" :class="{ 'is-open': openMenu === field.key }">
            <div class="selected" @click.stop="openMenu = openMenu === field.key ? null : field.key">
              <span>{{ intervalLabel(field.value) }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512" class="arrow">
                <path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path>
              </svg>
            </div>
            <div v-show="openMenu === field.key" class="options">
              <label
                v-for="opt in intervalOptions"
                :key="opt.value"
                class="option-item"
                :class="{ active: field.value === opt.value }"
                @click="selectInterval(field.key, opt.value)"
              >
                {{ opt.label }}
              </label>
            </div>
          </div>
        </div>

        <div class="form-group backup-start">
          <label>Export</label>
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
            <div class="chips" role="group" aria-label="Statuses to export">
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

          <div class="backup-actions">
            <button type="button" class="secondary-btn" :disabled="!canExport" @click="handleExport">
              Export JSON
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>Import</label>
          <p class="form-hint">
            Restores what a backup file holds. Titles are added and never removed; if a title is in
            both, the newer copy is kept.
          </p>
          <div class="backup-actions">
            <button type="button" class="secondary-btn" @click="importInput?.click()">
              Import JSON
            </button>
            <input
              ref="importInput"
              type="file"
              accept=".json,application/json"
              hidden
              @change="handleImportFile"
            />
          </div>
        </div>

        <p v-if="backupMessage" class="form-hint backup-message" role="status">{{ backupMessage }}</p>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button type="button" class="primary-btn" :disabled="isSaving" @click="handleSave">
          {{ isSaving ? 'Saving...' : 'Save' }}
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
  z-index: 200;
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

.form-group label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
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

.select {
  position: relative;
  color: var(--text-primary);
  width: 100%;
  user-select: none;
}

.selected {
  background-color: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 0.55rem 0;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.select.is-open .selected,
.selected:hover {
  border-color: var(--accent);
}

.arrow {
  height: 10px;
  width: 14px;
  transform: rotate(-90deg);
  fill: var(--text-primary);
  transition: transform 200ms ease;
}

.select.is-open .arrow {
  transform: rotate(0deg);
}

.options {
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  padding: 0.35rem;
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  box-shadow: 0 6px 18px var(--shadow);
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.options::-webkit-scrollbar {
  width: 6px;
}

.options::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.option-item {
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  transition: background-color 150ms ease, color 150ms ease;
  font-size: 0.88rem;
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

.backup-start {
  margin-top: 0.6rem;
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

.backup-actions {
  display: flex;
  gap: 0.65rem;
  margin-top: 0.2rem;
}

.backup-message {
  color: var(--text-secondary);
}

.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
