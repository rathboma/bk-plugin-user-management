<script setup lang="ts">
import { computed } from "vue";
import Icon from "./Icon.vue";

/** The icon Beekeeper Studio's sidebar uses for an object type. */
const props = defineProps<{ type: string; subtype?: string; size?: number }>();

const look = computed((): { name: string; color: string } => {
  switch (props.type) {
    case "table":
      if (props.subtype === "view") return { name: "grid_on", color: "var(--entity-view)" };
      if (props.subtype === "materialized view") return { name: "grid_on", color: "var(--entity-matview)" };
      if (props.subtype === "foreign table") return { name: "grid_on", color: "var(--text-light)" };
      return { name: "grid_on", color: "var(--entity-table)" };
    case "schema":
      return { name: "folder", color: "var(--text-lighter)" };
    case "database":
      return { name: "storage", color: "var(--entity-database)" };
    case "sequence":
      return { name: "format_list_numbered", color: "var(--text-light)" };
    case "function":
      return { name: "functions", color: "var(--brand-pink)" };
    case "type":
      return { name: "category", color: "var(--text-light)" };
    case "language":
      return { name: "code", color: "var(--text-light)" };
    case "fdw":
    case "server":
      return { name: "dns", color: "var(--text-light)" };
    case "tablespace":
      return { name: "inventory_2", color: "var(--text-light)" };
    case "column":
      return { name: "view_column", color: "var(--text-light)" };
    default:
      return { name: "help_outline", color: "var(--text-lighter)" };
  }
});
</script>

<template>
  <Icon :name="look.name" :color="look.color" :size="size ?? 16" />
</template>
