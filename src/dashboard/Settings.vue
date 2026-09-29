<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import browser from 'webextension-polyfill'
import { AppSettings } from '../types'
import { getSettings, saveSettings } from '../storage'
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
    hint: 'Waiting shows. Up to 2 a day.',
    value: settings.value.newSeasonCheckIntervalHours,
  },
  {
    key: 'reminder' as const,
    label: 'Reminders',
    hint: 'Watching titles. Up to 2 a day.',
    value: settings.value.reminderIntervalHours,
  },
])

const handleClickOutside = (event: MouseEvent) => {
  if (!(event.target as HTMLElement).closest('.select')) openMenu.value = null
}

onMounted(async () => {
  settings.value = await getSettings()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const selectInterval = (key: 'episode' | 'reminder', val: number) => {
  if (key === 'episode') settings.value.newSeasonCheckIntervalHours = val
  else settings.value.reminderIntervalHours = val
  openMenu.value = null
}

const handleSave = async () => {
  isSaving.value = true
  try {
    const saved = await saveSettings({ ...settings.value })

    try {
      await browser.runtime.sendMessage({
        type: 'SETTINGS_UPDATED',
        settings: saved,
      })
    } catch (error) {
      console.error('[Nyatching List] Background did not acknowledge settings:', error)
      await scheduleReleaseCheckAlarm(saved)
    }

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
        <h4>Notifications</h4>
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
