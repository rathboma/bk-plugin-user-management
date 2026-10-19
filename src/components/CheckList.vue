<script setup lang="ts">
import { reactive } from "vue";
import type { ChangePlan, Check } from "../engines/types";
import CodeText from "./CodeText.vue";
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

const collapsed = reactive(new Set<string>());
const showSecondary = reactive(new Set<string>());

function toggle(id: string) {
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
}
</script>

<template>
  <div class="box checks">
    <template v-for="check in checks" :key="check.id">
      <div class="check-row" :class="{ expandable: check.children?.length }" @click="check.children?.length && toggle(check.id)">
        <Icon :name="ICONS[check.status]" :size="18" :class="`status-${check.status}`" />
        <div class="text">
          <div class="label">{{ check.label }}</div>
          <div v-if="check.detail" class="detail"><CodeText :text="check.detail" /></div>
        </div>
        <button
          v-if="check.fix"
          class="btn small"
          :disabled="readOnly"
          :title="readOnly ? 'Read-only connection' : check.fix.statements.map((s) => s.display ?? s.sql).join(';\n')"
          @click.stop="emit('fix', check.fix!)"
        >
          <Icon name="fix" />Fix
        </button>
        <Icon
          v-if="check.children?.length"
          name="chevronRight"
          :size="18"
          class="chevron"
          :class="{ open: !collapsed.has(check.id) }"
        />
      </div>
      <template v-if="check.children?.length && !collapsed.has(check.id)">
        <div
          v-for="child in check.children.filter((c) => !c.secondary || showSecondary.has(check.id))"
          :key="child.label"
          class="child mono"
        >
          <span class="ref">{{ child.label }}</span>{{ child.text }}
        </div>
        <div v-if="check.children.some((c) => c.secondary)" class="child more">
          <button class="link quiet" @click="showSecondary.has(check.id) ? showSecondary.delete(check.id) : showSecondary.add(check.id)">
            {{ showSecondary.has(check.id) ? "Hide" : "Show" }}
            {{ check.children.filter((c) => c.secondary).length }}
            {{ check.secondaryLabel ?? "more" }}
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.check-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line-soft);
}
.check-row:hover,
.child:hover {
  background: var(--tint-1);
}
.check-row.expandable {
  cursor: pointer;
}
.checks > :last-child {
  border-bottom: 0;
}
.text {
  flex: 1;
  min-width: 0;
}
.label {
  font-size: 13px;
  color: var(--text-dark);
}
.detail {
  margin-top: 1px;
  font-size: 12.5px;
  color: var(--text-light);
  white-space: pre-line;
}
.chevron {
  color: var(--text-lighter);
  transition: transform 0.12s;
}
.chevron.open {
  transform: rotate(90deg);
}
.child {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 30px;
  padding: 0 14px 0 44px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12px;
  color: var(--text);
  white-space: pre;
  overflow: hidden;
}
.ref {
  width: 64px;
  flex: none;
  color: var(--text-lighter);
}
.child.more {
  font-family: var(--font-family);
  font-size: 12.5px;
}
</style>
