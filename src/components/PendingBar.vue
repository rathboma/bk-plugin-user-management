<script setup lang="ts">
import { computed } from "vue";
import { useManager } from "../state/inject";
import Icon from "./Icon.vue";

/** Membership edits waiting to be applied, like pending cell edits in a table tab. */
const m = useManager();
const plan = computed(() => m.pendingPlan());
const count = computed(() => m.state.pending.length);
const preview = computed(() => {
  const statements = plan.value?.statements ?? [];
  const first = statements[0];
  if (!first) return "";
  const sql = (first.display ?? first.sql).replace(/\s+/g, " ").replace(/;$/, "");
  return statements.length > 1 ? `${sql}; +${statements.length - 1} more` : sql;
});
</script>

<template>
  <div class="pending-bar" role="status">
    <Icon name="bolt" :size="16" color="var(--accent)" />
    <span class="label">{{ count === 1 ? "1 pending change" : `${count} pending changes` }}</span>
    <code v-if="preview" class="preview" :title="plan?.statements.map((s) => s.display ?? s.sql).join('\n')">{{ preview }}</code>
    <span class="grow" />
    <button class="btn ghost" @click="m.discardPending()">Discard</button>
    <button class="btn primary" :disabled="m.readOnly.value" @click="m.reviewPending()">Review &amp; apply</button>
  </div>
</template>

<style scoped>
.pending-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 20px;
  border-top: 1px solid var(--line);
  background: var(--raised);
}
.label {
  font-size: 13px;
  color: var(--text-dark);
  white-space: nowrap;
}
.preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--theme-base) 8%, transparent);
  font-family: var(--font-family-mono);
  font-size: 12px;
  color: var(--text);
}
</style>
