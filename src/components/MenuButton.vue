<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import Icon from "./Icon.vue";

interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  action: () => void;
}

/** A ⋯ button with a small menu. */
defineProps<{ items: MenuItem[]; title?: string }>();
const open = ref(false);
const root = ref<HTMLElement>();

function onOutside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}
function toggle() {
  open.value = !open.value;
  if (open.value) {
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
  } else close();
}
function close() {
  open.value = false;
  document.removeEventListener("mousedown", onOutside);
  document.removeEventListener("keydown", onKey);
}
function run(item: MenuItem) {
  close();
  item.action();
}
onBeforeUnmount(close);
</script>

<template>
  <div ref="root" class="menu-button">
    <button class="btn quiet icon-only" type="button" :title="title ?? 'More'" aria-haspopup="menu" :aria-expanded="open" @click="toggle">
      <Icon name="more_horiz" :size="18" />
    </button>
    <ul v-if="open" class="menu" role="menu">
      <li v-for="item in items" :key="item.label" role="none">
        <button type="button" role="menuitem" :class="{ danger: item.danger }" :disabled="item.disabled" @click="run(item)">
          <Icon v-if="item.icon" :name="item.icon" :size="16" />{{ item.label }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.menu-button {
  position: relative;
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 40;
  min-width: 180px;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--menu-bg, var(--raised));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-dark);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.menu button:hover:not(:disabled) {
  background: var(--tint-3);
}
.menu button.danger {
  color: var(--fail);
}
.menu button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
