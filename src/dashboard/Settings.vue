<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { saveNotificationSettings } from '../background/background.ts'

const emit = defineEmits(['close'])

const enabled = ref(true)
const intervalMinutes = ref(1440) // Default 24 Hours

const optionsList = [
  { label: 'Every Hour', value: 60 },
  { label: 'Every 6 Hours', value: 360 },
  { label: 'Every 12 Hours', value: 720 },
  { label: 'Daily (24 Hours)', value: 1440 },
  { label: 'Every 2 Days (48 Hours)', value: 2880 },
  { label: 'Weekly (7 Days)', value: 10080 },
  { label: 'Bi-Weekly (14 Days)', value: 20160 },
  { label: 'Monthly (30 Days)', value: 43200 }
]

const selectedLabel = computed(() => {
  const match = optionsList.find((opt) => opt.value === intervalMinutes.value)
  return match ? match.label : 'Select frequency'
})

onMounted(async () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const res = await chrome.storage.local.get('notification_settings')
    if (res.notification_settings) {
      enabled.value = res.notification_settings.enabled ?? true
      intervalMinutes.value = res.notification_settings.intervalMinutes ?? 1440
    }
  }
})

const selectOption = (val: number) => {
  intervalMinutes.value = val
}

const saveSettings = async () => {
  // Delegate storage saving & chrome.alarms setup to background.ts helper
  await saveNotificationSettings({
    enabled: enabled.value,
    intervalMinutes: Number(intervalMinutes.value)
  })
  
  emit('close')
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>Settings</h4>
        <button type="button" class="close-btn" aria-label="Close settings" @click="emit('close')">✕</button>
      </div>

      <div class="form-group">
        <label class="toggle-label">
          <span>Enable Background Check</span>
          <input type="checkbox" v-model="enabled" class="toggle-checkbox" />
        </label>
      </div>

      <div v-if="enabled" class="form-group">
        <label>Check Frequency</label>
        
        <!-- Dashboard-style Select Dropdown -->
        <div class="select modal-select">
          <div class="selected">
            <span>{{ selectedLabel }}</span>
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
              v-for="opt in optionsList"
              :key="opt.value"
              class="option-item"
              :class="{ active: intervalMinutes === opt.value }"
              @click="selectOption(opt.value)"
            >
              {{ opt.label }}
            </label>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
        <button type="button" class="primary-btn" @click="saveSettings">Save</button>
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
  width: 320px;
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

.form-group {
  margin-bottom: 1.1rem;
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

/* Custom Select Dropdown */
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
  padding: 0.55rem 0.85rem;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: border-color 0.2s ease;
}

.arrow {
  height: 10px;
  width: 14px;
  transform: rotate(-90deg);
  fill: var(--text-primary);
  transition: transform 200ms ease;
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
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  transform: translateY(-2px);
  z-index: 100;
  max-height: 200px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

/* Custom Scrollbar Styling */
.options::-webkit-scrollbar {
  width: 6px;
}

.options::-webkit-scrollbar-track {
  background: transparent;
}

.options::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

.options::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

.select:hover > .options {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateY(0);
}

.select:hover > .selected {
  border-color: var(--accent);
}

.select:hover > .selected .arrow {
  transform: rotate(0deg);
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