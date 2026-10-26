<script setup lang="ts">
import { ref, computed } from 'vue'
import { importBackup, parseBackup, Backup, ImportResult } from '../storage'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'imported', result: ImportResult): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const backup = ref<Backup | null>(null)
const fileName = ref('')
const importMedia = ref(true)
const importSettings = ref(true)
const importNotifications = ref(true)
const isImporting = ref(false)
const message = ref('')

const choice = computed(() => ({
  media: !!backup.value?.media && importMedia.value,
  settings: !!backup.value?.settings && importSettings.value,
  notifications: !!backup.value?.notifications && importNotifications.value,
}))
const canImport = computed(
  () =>
    !!backup.value &&
    !isImporting.value &&
    (choice.value.media || choice.value.settings || choice.value.notifications)
)
const exportedOn = computed(() => {
  const raw = backup.value?.exportedAt ?? ''
  const date = new Date(raw)
  return isNaN(date.getTime()) ? raw : date.toLocaleDateString()
})

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

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

const handleFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    backup.value = parseBackup(await file.text())
    fileName.value = file.name
    importMedia.value = importSettings.value = importNotifications.value = true
    message.value = ''
  } catch (error) {
    backup.value = null
    message.value = (error as Error).message
  }
}

const handleImport = async () => {
  if (!backup.value) return
  isImporting.value = true
  try {
    const result = await importBackup(backup.value, choice.value)
    message.value = `Imported: ${describeImport(result)}.`
    emit('imported', result)
  } catch (error) {
    console.error('[Nyatching List] Import failed:', error)
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
        <h4>Import</h4>
        <button type="button" class="close-btn" aria-label="Close import" @click="emit('close')">
          ✕
        </button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <p class="form-hint">Choose a JSON backup file.</p>
          <div class="backup-actions">
            <button type="button" class="secondary-btn" @click="fileInput?.click()">
              Choose file
            </button>
            <input
              ref="fileInput"
              type="file"
              accept=".json,application/json"
              hidden
              @change="handleFile"
            />
          </div>
        </div>

        <div v-if="backup" class="form-group">
          <p class="form-hint">{{ fileName }}, exported {{ exportedOn }}</p>

          <label v-if="backup.media" class="check-row">
            <input v-model="importMedia" type="checkbox" />
            <span>Titles ({{ backup.media.length }})</span>
          </label>
          <label v-if="backup.settings" class="check-row">
            <input v-model="importSettings" type="checkbox" />
            <span>Settings</span>
          </label>
          <label v-if="backup.notifications" class="check-row">
            <input v-model="importNotifications" type="checkbox" />
            <span>Notification history ({{ backup.notifications.length }})</span>
          </label>

          <p v-if="backup.media" class="form-hint">
            Titles are added and never removed. If a title is in both, the newer copy is kept.
          </p>
        </div>

        <p v-if="message" class="form-hint backup-message" role="status">{{ message }}</p>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button type="button" class="primary-btn" :disabled="!canImport" @click="handleImport">
          Import
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

.backup-actions {
  display: flex;
  gap: 0.65rem;
  margin-top: 0.2rem;
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
