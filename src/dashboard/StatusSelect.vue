<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { MediaStatus } from '../types'

defineProps<{ modelValue: MediaStatus; label: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: MediaStatus): void }>()

const STATUSES: MediaStatus[] = ['watching', 'waiting', 'next', 'completed', 'dropped']
const MENU_HEIGHT = 170
const MENU_WIDTH = 125

const statusLabel = (s: MediaStatus) =>
  s === 'next' ? 'Next up' : s.charAt(0).toUpperCase() + s.slice(1)

const root = ref<HTMLElement | null>(null)
// null = closed
const menuStyle = ref<Record<string, string> | null>(null)

const onOutside = (event: MouseEvent) => {
  if (!root.value?.contains(event.target as Node)) close()
}

function close() {
  menuStyle.value = null
  document.removeEventListener('click', onOutside, true)
  window.removeEventListener('scroll', close, true)
}

const toggle = () => {
  if (menuStyle.value || !root.value) return close()
  const r = root.value.getBoundingClientRect()
  // Fixed so the scrolling list cannot clip it; opens upward near the bottom of the window
  const up = r.bottom + MENU_HEIGHT > window.innerHeight
  menuStyle.value = {
    left: `${r.right - MENU_WIDTH}px`,
    ...(up
      ? { bottom: `${window.innerHeight - r.top + 4}px` }
      : { top: `${r.bottom + 4}px` }),
  }
  document.addEventListener('click', onOutside, true)
  window.addEventListener('scroll', close, true)
}

const pick = (status: MediaStatus) => {
  emit('update:modelValue', status)
  close()
}

onUnmounted(close)
</script>

<template>
  <div ref="root" class="select" :class="{ 'is-open': menuStyle }" @keydown.esc="close">
    <button
      type="button"
      class="selected"
      :aria-label="label"
      aria-haspopup="true"
      :aria-expanded="!!menuStyle"
      @click="toggle"
    >
      <span>{{ statusLabel(modelValue) }}</span>
      <svg viewBox="0 0 512 512" class="arrow" aria-hidden="true">
        <path
          d="M233.4 406.6c12.5 12.5 32.8 12.5 45.3 0l192-192c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L256 338.7 86.6 169.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3l192 192z"
        />
      </svg>
    </button>
    <div v-if="menuStyle" class="options" :style="menuStyle">
      <button
        v-for="s in STATUSES"
        :key="s"
        type="button"
        class="option-item"
        :class="{ active: modelValue === s }"
        :aria-pressed="modelValue === s"
        @click="pick(s)"
      >
        {{ statusLabel(s) }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.select {
  position: relative;
  flex-shrink: 0;
  color: var(--text-primary);
}

.selected {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: 1px solid var(--border);
  color: inherit;
  font: inherit;
  padding: 0.3rem 0.6rem;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.selected:hover,
.select.is-open .selected {
  border-color: var(--accent);
}

.arrow {
  height: 8px;
  width: 12px;
  transform: rotate(-90deg);
  fill: var(--text-primary);
  transition: transform 200ms ease;
}

.select.is-open .arrow {
  transform: rotate(0deg);
}

.options {
  position: fixed;
  z-index: 300;
  display: flex;
  flex-direction: column;
  width: 125px;
  box-sizing: border-box;
  padding: 0.3rem;
  background-color: var(--bg-card);
  border: 1px solid var(--border);
}

.option-item {
  padding: 0.35rem 0.55rem;
  background: none;
  border: none;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 500;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
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
</style>
