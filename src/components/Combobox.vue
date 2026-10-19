<script setup lang="ts" generic="T extends { value: string; label: string; hint?: string }">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";

/**
 * A dropdown with a search box, for lists too long for a native select.
 * Pass an #icon slot to show an icon before each item.
 */
const props = defineProps<{
  items: T[];
  modelValue: string | undefined;
  placeholder?: string;
  mono?: boolean;
  loading?: boolean;
  id?: string;
  label?: string;
  minWidth?: string;
  /** Also accept a typed value that isn't in the list. */
  freeText?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
defineSlots<{ icon?(props: { item: T }): unknown }>();

const LIMIT = 300;
const open = ref(false);
const term = ref("");
const active = ref(0);
const root = ref<HTMLElement>();
const search = ref<HTMLInputElement>();
const list = ref<HTMLElement>();

const selected = computed(() => props.items.find((i) => i.value === props.modelValue));
const matches = computed(() => {
  const t = term.value.trim().toLowerCase();
  return t ? props.items.filter((i) => i.label.toLowerCase().includes(t)) : props.items;
});
const custom = computed(() => {
  const t = term.value.trim();
  return props.freeText && t && !props.items.some((i) => i.value === t) ? ({ value: t, label: t, hint: "use this" } as T) : undefined;
});
const shown = computed(() => [...(custom.value ? [custom.value] : []), ...matches.value.slice(0, LIMIT)]);

function onOutside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

async function toggle() {
  if (open.value) return close();
  open.value = true;
  term.value = "";
  active.value = Math.max(0, shown.value.findIndex((i) => i.value === props.modelValue));
  document.addEventListener("mousedown", onOutside);
  await nextTick();
  search.value?.focus();
  scrollToActive();
}

function close() {
  open.value = false;
  document.removeEventListener("mousedown", onOutside);
}

function choose(item: T | undefined) {
  if (!item) return;
  emit("update:modelValue", item.value);
  close();
}

function scrollToActive() {
  void nextTick(() => list.value?.querySelector<HTMLElement>(".active")?.scrollIntoView({ block: "nearest" }));
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    active.value = Math.min(shown.value.length - 1, active.value + 1);
    scrollToActive();
  } else if (event.key === "ArrowUp") {
    active.value = Math.max(0, active.value - 1);
    scrollToActive();
  } else if (event.key === "Enter") {
    choose(shown.value[active.value]);
  } else if (event.key === "Escape") {
    event.stopPropagation();
    close();
  } else {
    return;
  }
  event.preventDefault();
}

onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside));
</script>

<template>
  <div ref="root" class="combo" :style="{ minWidth }">
    <button
      :id="id"
      type="button"
      class="trigger"
      :class="{ mono, placeholder: !selected && !(freeText && modelValue) }"
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <slot v-if="selected" name="icon" :item="selected" />
      <span class="text">{{ selected?.label ?? (freeText && modelValue ? modelValue : loading ? "Loading…" : placeholder) }}</span>
    </button>
    <div v-if="open" class="popover" @keydown="onKeydown">
      <div class="search-field">
        <i class="material-icons">search</i>
        <input
          ref="search"
          v-model="term"
          class="input"
          :class="{ mono }"
          :placeholder="freeText ? 'Search or type a name' : 'Search'"
          aria-label="Search"
          @input="active = 0"
        />
      </div>
      <ul ref="list" class="options" role="listbox">
        <li
          v-for="(item, i) in shown"
          :key="item.value"
          role="option"
          :aria-selected="item.value === modelValue"
          :class="{ active: i === active, selected: item.value === modelValue }"
          @mousedown.prevent="choose(item)"
          @mousemove="active = i"
        >
          <slot name="icon" :item="item" />
          <span class="label" :class="{ mono }">{{ item.label }}</span>
          <span v-if="item.hint" class="item-hint">{{ item.hint }}</span>
        </li>
        <li v-if="!shown.length" class="none">{{ loading ? "Loading…" : "No matches" }}</li>
        <li v-if="matches.length > LIMIT" class="none">{{ matches.length - LIMIT }} more. Keep typing to narrow down.</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 26px;
  padding: 0 26px 0 8px;
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-base) 2%, transparent);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text-dark);
  font: inherit;
  font-size: 13.3px;
  text-align: left;
  cursor: pointer;
}
.trigger:hover {
  background: color-mix(in srgb, var(--theme-base) 5%, transparent);
}
.trigger::after {
  content: "";
  position: absolute;
  right: 9px;
  top: 50%;
  margin-top: -2px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid var(--text-dark);
}
.trigger.placeholder .text {
  color: var(--text-lighter);
}
.trigger.mono .text {
  font-family: var(--font-family-mono);
  font-size: 12.5px;
}
.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: max(100%, 300px);
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--menu-bg, var(--raised));
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.options {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  max-height: 280px;
  overflow: auto;
}
.options li {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--text-dark);
  cursor: pointer;
}
.options li.active {
  background: var(--tint-3);
}
.options li.selected .label {
  color: var(--accent);
}
.options .label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.options .label.mono {
  font-family: var(--font-family-mono);
  font-size: 12.5px;
}
.item-hint {
  font-size: 11.5px;
  color: var(--text-lighter);
}
.options li.none {
  color: var(--text-lighter);
  cursor: default;
  font-size: 12.5px;
}
.options li.none:hover {
  background: none;
}
</style>
