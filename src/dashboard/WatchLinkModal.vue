<script setup lang="ts">
import { ref } from 'vue'
import { TrackedMedia } from '../types'
import { updateMedia } from '../storage'

const props = defineProps<{
  item: TrackedMedia
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const watchingUrl = ref(props.item.watchingUrl ?? '')
const isSaving = ref(false)

const handleSave = async () => {
  isSaving.value = true
  try {
    await updateMedia({
      id: props.item.id,
      watchingUrl: watchingUrl.value.trim(),
    })
    emit('close')
  } catch (error) {
    console.error('[Nyatching List] Failed to save watch link:', error)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>Watch Link</h4>
        <button type="button" class="close-btn" aria-label="Close watch link editor" @click="emit('close')">✕</button>
      </div>

      <form class="modal-body" @submit.prevent="handleSave">
        <p class="modal-subtitle">{{ item.title }}</p>

        <div class="form-group">
          <label for="watch-link-input">Watching URL</label>
          <input
            id="watch-link-input"
            v-model="watchingUrl"
            type="text"
            inputmode="url"
            placeholder="https://site.com/watch/..."
            autocomplete="off"
            autofocus
          />
          <span class="field-hint">Leave empty for no link.</span>
        </div>

        <div class="modal-actions">
          <button type="button" class="secondary-btn" @click="emit('close')">Cancel</button>
          <button type="submit" class="primary-btn" :disabled="isSaving">
            {{ isSaving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </form>
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
  width: 380px;
  max-width: calc(100vw - 2rem);
  color: var(--text-primary);
  box-shadow: 0 8px 24px var(--shadow);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.85rem;
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

.modal-subtitle {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
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

.form-group input {
  padding: 0.55rem 0.85rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: inherit;
  width: 100%;
  box-sizing: border-box;
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
}

.field-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.65rem;
  margin-top: 0.3rem;
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
