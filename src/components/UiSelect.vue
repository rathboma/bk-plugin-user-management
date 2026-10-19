<script setup lang="ts">
/** A native select drawn like Beekeeper Studio's: hairline border and a small triangle. */
defineProps<{ modelValue: string; mono?: boolean; id?: string; label?: string; disabled?: boolean }>();
defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <span class="ui-select" :class="{ mono }">
    <select
      :id="id"
      :value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
  </span>
</template>

<style scoped>
.ui-select {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.ui-select::after {
  content: "";
  position: absolute;
  right: 9px;
  top: 50%;
  margin-top: -2px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid var(--text-dark);
  pointer-events: none;
}
select {
  appearance: none;
  width: 100%;
  height: 26px;
  padding: 0 26px 0 10px;
  border: 0;
  border-radius: 4px;
  background: color-mix(in srgb, var(--theme-base) 2%, transparent);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text-dark);
  font: inherit;
  font-size: 13.3px;
  cursor: pointer;
}
select:hover:not(:disabled) {
  background: color-mix(in srgb, var(--theme-base) 5%, transparent);
}
select:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--input-highlight);
}
select option {
  background: var(--menu-bg, var(--theme-bg));
  color: var(--text-dark);
}
.mono select {
  font-family: var(--font-family-mono);
}
</style>
