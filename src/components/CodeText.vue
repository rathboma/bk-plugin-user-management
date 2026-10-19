<script setup lang="ts">
import { computed } from "vue";

/** Text with SQL fragments such as "SET ROLE app_writers" shown as inline code. */
const props = defineProps<{ text: string }>();
const SQL = /(SET ROLE [\w$"]+|REASSIGN OWNED|DROP OWNED)/g;
const parts = computed(() => props.text.split(SQL).map((text, i) => ({ text, code: i % 2 === 1 })));
</script>

<template>
  <span><template v-for="(part, i) in parts" :key="i"><code v-if="part.code" class="inline-code">{{ part.text }}</code><template v-else>{{ part.text }}</template></template></span>
</template>
