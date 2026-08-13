<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
import { AppSettings } from '../types'
import { getSettings, saveSettings } from '../storage'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const isSaving = ref(false)

// Dropdown state controls
const isOpenSeason = ref(false)
const isOpenStall = ref(false)

const settings = ref<AppSettings>({
  newSeasonCheckIntervalHours: 24,
  stallReminderDays: 7,
  enableSystemNotifications: true,
})

// Episode Check Interval Options (Value in Hours)
const seasonOptions = [
  { label: '1 Day', value: 24 },
  { label: '2 Days', value: 48 },
  { label: '1 Week', value: 168 },
  { label: '2 Weeks', value: 336 },
  { label: '1 Month', value: 720 },
  { label: '2 Months', value: 1440 },
  { label: '6 Months', value: 4320 },
  { label: '1 Year', value: 8760 },
]

// Inactivity Reminder Options (Value in Days)
const stallOptions = [
  { label: '1 Day', value: 1 },
  { label: '2 Days', value: 2 },
  { label: '1 Week', value: 7 },
  { label: '2 Weeks', value: 14 },
  { label: '1 Month', value: 30 },
  { label: '2 Months', value: 60 },
  { label: '6 Months', value: 180 },
  { label: '1 Year', value: 365 },
]

const selectedSeasonLabel = computed(() => {
  const match = seasonOptions.find((opt) => opt.value === settings.value.newSeasonCheckIntervalHours)
  return match ? match.label : 'Select interval'
})

const selectedStallLabel = computed(() => {
  const match = stallOptions.find((opt) => opt.value === settings.value.stallReminderDays)
  return match ? match.label : 'Select threshold'
})

// Close dropdowns when clicking outside
const handleClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement
  if (!target.closest('.select-season')) {
    isOpenSeason.value = false
  }
  if (!target.closest('.select-stall')) {
    isOpenStall.value = false
  }
}

onMounted(async () => {
  settings.value = await getSettings()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})

const toggleSeasonDropdown = () => {
  isOpenSeason.value = !isOpenSeason.value
  isOpenStall.value = false
}

const toggleStallDropdown = () => {
  isOpenStall.value = !isOpenStall.value
  isOpenSeason.value = false
}

const selectSeasonOption = (val: number) => {
  settings.value.newSeasonCheckIntervalHours = val
  isOpenSeason.value = false
}

const selectStallOption = (val: number) => {
  settings.value.stallReminderDays = val
  isOpenStall.value = false
}

const handleSave = async () => {
  isSaving.value = true
  try {
    await saveSettings(settings.value)

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: settings.value })
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
        <h4>Notification Settings</h4>
        <button type="button" class="close-btn" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>

      <div class="modal-body">
        <!-- Desktop Notifications Toggle -->
        <div class="form-group">
          <label class="toggle-label">
            <span>Desktop System Notifications</span>
            <input type="checkbox" v-model="settings.enableSystemNotifications" class="toggle-checkbox" />
          </label>
        </div>

        <!-- New Season/Episode Check Frequency -->
        <div class="form-group">
          <label>New Episode Check Frequency</label>
          <div class="select select-season" :class="{ 'is-open': isOpenSeason }">
            <div class="selected" @click="toggleSeasonDropdown">
              <span>{{ selectedSeasonLabel }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512" class="arrow">
                <path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path>
              </svg>
            </div>
            <div v-show="isOpenSeason" class="options">
              <label
                v-for="opt in seasonOptions"
                :key="opt.value"
                class="option-item"
                :class="{ active: settings.newSeasonCheckIntervalHours === opt.value }"
                @click="selectSeasonOption(opt.value)"
              >
                {{ opt.label }}
              </label>
            </div>
          </div>
        </div>

        <!-- Inactivity Reminder Frequency -->
        <div class="form-group">
          <label>Inactivity Reminder Frequency</label>
          <div class="select select-stall" :class="{ 'is-open': isOpenStall }">
            <div class="selected" @click="toggleStallDropdown">
              <span>{{ selectedStallLabel }}</span>
              <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512" class="arrow">
                <path d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"></path>
              </svg>
            </div>
            <div v-show="isOpenStall" class="options">
              <label
                v-for="opt in stallOptions"
                :key="opt.value"
                class="option-item"
                :class="{ active: settings.stallReminderDays === opt.value }"
                @click="selectStallOption(opt.value)"
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
  backdrop-filter: blur(2px);
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
  width: 340px;
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

.toggle-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.92rem;
  color: var(--text-primary);
  cursor: pointer;
}

.toggle-checkbox {
  width: 1.15rem;
  height: 1.15rem;
  accent-color: var(--accent);
  cursor: pointer;
}

/* Custom Dropdown Styling */
.select {
  position: relative;
  color: var(--text-primary);
  width: 100%;
  user-select: none;
}

.selected {
  background-color: var(--bg-input);
  border: 1px solid var(--border);
  padding: 0.55rem 0.85rem;
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
  border: 1px solid var(--accent);
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
  background-color: var(--bg-input);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}

.secondary-btn:hover {
  background-color: var(--bg-card);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.primary-btn:active,
.secondary-btn:active {
  transform: scale(0.98);
}
</style>