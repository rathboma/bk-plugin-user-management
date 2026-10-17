<script setup lang="ts">
import type { ChangePlan, Check } from "../engines/types";
import Icon from "./Icon.vue";

defineProps<{ checks: Check[]; readOnly?: boolean }>();
const emit = defineEmits<{ fix: [plan: ChangePlan] }>();

const ICONS: Record<Check["status"], string> = {
  ok: "ok",
  fail: "fail",
  warn: "warning",
  info: "info",
  unknown: "unknown",
};
</script>

<template>
  <ul class="checks">
    <li v-for="check in checks" :key="check.id" class="check-item" :class="check.status">
      <Icon :name="ICONS[check.status]" class="status" :class="`tone-${check.status}`" />
      <div class="grow">
        <div class="check-title">{{ check.label }}</div>
        <div v-if="check.detail" class="check-detail">{{ check.detail }}</div>
      </div>
      <button
        v-if="check.fix"
        class="btn"
        :disabled="readOnly"
        :title="readOnly ? 'Read-only connection' : check.fix.statements.map((s) => s.display ?? s.sql).join(';\n')"
        @click="emit('fix', check.fix!)"
      >
        <Icon name="edit" :size="13" /> Fix
      </button>
    </li>
  </ul>
</template>

<style scoped>
.checks {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--raised);
}
.check-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
}
.check-item:last-child {
  border-bottom: 0;
}
.status {
  margin-top: 1px;
}
.check-title {
  font-weight: 600;
  font-size: 0.8125rem;
}
.check-detail {
  margin-top: 2px;
  color: var(--text);
  font-size: 0.8125rem;
  line-height: 1.4;
  white-space: pre-line;
}
.check-item.ok .check-title {
  font-weight: 500;
}
</style>
