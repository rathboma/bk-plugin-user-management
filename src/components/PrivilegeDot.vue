<script setup lang="ts">
import { computed } from "vue";
import type { PrivilegeCell } from "../engines/types";
import { describeSource } from "../core/sources";

const props = defineProps<{ cell: PrivilegeCell | undefined; label?: string }>();

const primary = computed(() => props.cell?.sources.find((s) => !s.needsSetRole) ?? props.cell?.sources[0]);
const setRoleOnly = computed(() => props.cell && !props.cell.allowed && props.cell.sources.length > 0);
const title = computed(() => {
  if (!props.cell) return "";
  const head = props.label ? `${props.label}: ` : "";
  if (!props.cell.allowed && !props.cell.sources.length) return `${head}not allowed`;
  return head + props.cell.sources.map(describeSource).join("\n");
});
</script>

<template>
  <span
    class="dot"
    :class="[cell?.allowed ? `on src-${primary?.kind}` : setRoleOnly ? 'setrole' : 'off']"
    :title="title"
    :aria-label="title"
    role="img"
  />
</template>

<style scoped>
.dot {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  vertical-align: middle;
}
.dot.on {
  background: var(--src);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--src) 22%, transparent);
}
.dot.off {
  width: 8px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-lighter);
  opacity: 0.6;
}
.dot.setrole {
  border: 1.5px dashed var(--text-light);
}
</style>
