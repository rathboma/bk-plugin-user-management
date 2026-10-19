<script setup lang="ts">
import { computed } from "vue";

/** Short names used across the plugin, mapped to Material Icons ligatures. Other names pass through. */
const ALIASES: Record<string, string> = {
  user: "person",
  role: "group",
  system: "admin_panel_settings",
  plus: "add",
  trash: "delete",
  copy: "content_copy",
  external: "open_in_new",
  ok: "check_circle",
  fail: "cancel",
  warning: "warning_amber",
  unknown: "help_outline",
  chevronDown: "keyboard_arrow_down",
  chevronRight: "keyboard_arrow_right",
  back: "arrow_back",
  lock: "lock",
  table: "grid_on",
  database: "storage",
  schema: "folder",
  play: "play_arrow",
  bug: "troubleshoot",
  fix: "build",
  more: "more_horiz",
};

const props = defineProps<{ name: string; size?: number; color?: string; title?: string }>();
const ligature = computed(() => ALIASES[props.name] ?? props.name);
</script>

<template>
  <i
    class="material-icons"
    :style="{ fontSize: size ? `${size}px` : undefined, color }"
    :title="title"
    :aria-hidden="title ? undefined : 'true'"
    :role="title ? 'img' : undefined"
    :aria-label="title"
    >{{ ligature }}</i
  >
</template>
