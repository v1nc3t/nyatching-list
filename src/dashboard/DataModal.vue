<script setup lang="ts">
import { ref } from 'vue'
import { ImportResult } from '../storage'
import { notifySettingsUpdated } from '../background/alarm-schedule'
import ExportModal from './ExportModal.vue'
import ImportModal from './ImportModal.vue'
import ImdbImportModal from './ImdbImportModal.vue'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const showExport = ref(false)
const showImport = ref(false)
const imdbList = ref<'ratings' | 'watchlist' | null>(null)

const handleImported = async (result: ImportResult) => {
  emit('close')
  if (result.settings) await notifySettingsUpdated(result.settings)
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <div class="modal-header">
        <h4>Import / Export</h4>
        <button type="button" class="close-btn" aria-label="Close import / export" @click="emit('close')">
          ✕
        </button>
      </div>

      <div class="modal-body">
        <section class="form-group">
          <h5>Nyatching List</h5>
          <p class="form-hint">Save your data to a JSON file or restore it.</p>
          <div class="backup-actions">
            <button type="button" class="secondary-btn" @click="showImport = true">Import…</button>
            <button type="button" class="secondary-btn" @click="showExport = true">Export…</button>
          </div>
        </section>

        <section class="form-group">
          <h5>IMDb</h5>
          <p class="form-hint">Add titles from your IMDb ratings or watchlist CSV export.</p>
          <div class="backup-actions">
            <button type="button" class="secondary-btn" @click="imdbList = 'ratings'">
              Import ratings…
            </button>
            <button type="button" class="secondary-btn" @click="imdbList = 'watchlist'">
              Import watchlist…
            </button>
          </div>
        </section>
      </div>
    </div>

    <Teleport to="body">
      <ExportModal v-if="showExport" @close="showExport = false" @exported="emit('close')" />
      <ImportModal v-if="showImport" @close="showImport = false" @imported="handleImported" />
      <ImdbImportModal
        v-if="imdbList"
        :list="imdbList"
        @close="imdbList = null"
        @imported="emit('close')"
      />
    </Teleport>
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

.form-group h5 {
  margin: 0;
  font-family: var(--font-mono);
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
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.2rem;
}

.secondary-btn {
  font-size: 0.88rem;
  font-weight: 600;
  padding: 0.55rem 1.1rem;
  border-radius: 8px;
  cursor: pointer;
  background-color: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
  transition: border-color 0.15s ease, transform 0.1s ease;
}

.secondary-btn:active {
  transform: scale(0.98);
}

.secondary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}
</style>
