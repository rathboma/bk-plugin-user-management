<script setup lang="ts">
import Icon from "./Icon.vue";

/** Person for users, group for roles, a shield for built-in roles. */
defineProps<{ kind?: string; system?: boolean; size?: number }>();
</script>

<template>
  <Icon v-if="system" name="admin_panel_settings" color="var(--text-lighter)" :size="size ?? 16" />
  <Icon v-else-if="kind === 'user'" name="person" color="var(--entity-user)" :size="size ?? 16" />
  <Icon v-else name="group" color="var(--entity-role)" :size="size ?? 16" />
</template>
