<script setup lang="ts">
import { computed, ref } from "vue";

/** A searchable list of checkboxes. */
const props = defineProps<{
  items: { value: string; label: string; hint?: string; disabled?: boolean }[];
  modelValue: string[];
  placeholder?: string;
  empty?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const term = ref("");

const visible = computed(() => {
  const t = term.value.trim().toLowerCase();
  return props.items.filter((i) => !t || i.label.toLowerCase().includes(t));
});

function toggle(value: string, on: boolean) {
  const next = new Set(props.modelValue);
  if (on) next.add(value);
  else next.delete(value);
  emit("update:modelValue", props.items.map((i) => i.value).filter((v) => next.has(v)));
}
</script>

<template>
  <div class="filter-list">
    <input v-if="items.length > 8" v-model="term" class="input" type="search" :placeholder="placeholder ?? 'Filter'" />
    <div class="items">
      <label v-for="item in visible" :key="item.value" class="check" :class="{ disabled: item.disabled }">
        <input
          type="checkbox"
          :checked="modelValue.includes(item.value)"
          :disabled="item.disabled"
          @change="toggle(item.value, ($event.target as HTMLInputElement).checked)"
        />
        <span class="check-label">{{ item.label }}</span>
        <span v-if="item.hint" class="hint">{{ item.hint }}</span>
      </label>
      <div v-if="!visible.length" class="hint none">{{ items.length ? "No matches" : (empty ?? "Nothing to choose from") }}</div>
    </div>
  </div>
</template>

<style scoped>
.filter-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.items {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: transparent;
}
.items .check {
  align-items: center;
}
.items .check input {
  margin: 0;
}
.none {
  padding: 4px 0;
}
</style>
