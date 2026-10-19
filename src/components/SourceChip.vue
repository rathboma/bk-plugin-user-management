<script setup lang="ts">
import { computed } from "vue";
import { SOURCE_LETTERS as LETTERS, describeSource } from "../core/sources";
import type { PrivilegeCell, PrivilegeSource } from "../engines/types";

/**
 * A letter for where a privilege comes from: D direct, R through a role,
 * O owner, P PUBLIC, B built-in role, S superuser. Dashed when it only works
 * after SET ROLE, a dash when there's no access.
 */
const props = defineProps<{
  cell?: PrivilegeCell;
  source?: PrivilegeSource;
  label?: string;
  clickable?: boolean;
  small?: boolean;
}>();
defineEmits<{ click: [] }>();

const primary = computed(
  () => props.source ?? props.cell?.sources.find((s) => !s.needsSetRole) ?? props.cell?.sources[0]
);
const none = computed(() => !props.source && (!props.cell || (!props.cell.allowed && !props.cell.sources.length)));
const setRole = computed(() => !none.value && (props.source ? props.source.needsSetRole : !props.cell?.allowed));
const letter = computed(() => (none.value ? "–" : LETTERS[primary.value?.kind ?? "unknown"]));
const title = computed(() => {
  const head = props.label ? `${props.label}: ` : "";
  if (none.value) return `${head}no access`;
  const list = props.source ? [props.source] : (props.cell?.sources ?? []);
  return head + list.map(describeSource).join("\n");
});
const classes = computed(() => [
  "chip",
  props.small ? "small" : "",
  none.value ? "none" : `src-${primary.value?.kind ?? "unknown"}`,
  setRole.value ? "setrole" : "",
]);
</script>

<template>
  <button v-if="clickable" type="button" :class="classes" :title="title" :aria-label="title" @click="$emit('click')">
    {{ letter }}
  </button>
  <span v-else :class="classes" :title="title" role="img" :aria-label="title">{{ letter }}</span>
</template>
