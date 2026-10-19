<script setup lang="ts">
import { computed } from "vue";
import { useManager } from "../state/inject";
import PrincipalIcon from "./PrincipalIcon.vue";

/** A user or role name with its icon, that selects it when clicked. */
const props = defineProps<{ name: string; size?: number }>();
const m = useManager();
const principal = computed(() => m.state.principals.find((p) => p.name === props.name));
</script>

<template>
  <button v-if="principal" class="entity" type="button" @click="m.select(principal.id)">
    <PrincipalIcon :kind="principal.kind" :system="principal.system" :size="size ?? 16" />{{ name }}
  </button>
  <span v-else class="entity">{{ name === "public" ? "PUBLIC" : name }}</span>
</template>
