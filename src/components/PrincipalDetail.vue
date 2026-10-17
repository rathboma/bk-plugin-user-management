<script setup lang="ts">
import { computed } from "vue";
import { useManager } from "../state/inject";
import type { DetailTab } from "../state/manager";
import Icon from "./Icon.vue";
import OverviewTab from "./tabs/OverviewTab.vue";
import MembershipsTab from "./tabs/MembershipsTab.vue";
import GrantsTab from "./tabs/GrantsTab.vue";
import EffectiveTab from "./tabs/EffectiveTab.vue";
import SettingsTab from "./tabs/SettingsTab.vue";
import SessionsTab from "./tabs/SessionsTab.vue";
import DebugTab from "./tabs/DebugTab.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const kindLabel = computed(() => {
  const p = principal.value;
  if (!p) return "";
  const kind = m.caps.value?.kinds.find((k) => k.id === p.kind)?.singular ?? p.kind;
  return p.system ? `System ${kind.toLowerCase()}` : kind;
});

const memberCounts = computed(() => {
  const name = principal.value?.name;
  return {
    memberOf: state.memberships.filter((x) => x.member === name).length,
    members: state.memberships.filter((x) => x.role === name).length,
  };
});

const tabs = computed(() => {
  const caps = m.caps.value;
  const list: { id: DetailTab; label: string; count?: number }[] = [{ id: "overview", label: "Overview" }];
  if (caps?.memberships.supported) list.push({ id: "memberships", label: "Memberships", count: memberCounts.value.memberOf + memberCounts.value.members });
  list.push({ id: "grants", label: "Grants", count: state.detail ? state.detail.grants.length + state.detail.defaultGrants.length : undefined });
  list.push({ id: "effective", label: "Effective access" });
  if (caps?.settings) list.push({ id: "settings", label: "Settings", count: state.detail?.settings.length });
  if (caps?.sessions) list.push({ id: "sessions", label: "Sessions", count: principal.value?.sessions });
  list.push({ id: "debug", label: "Debug" });
  return list;
});

const activeTab = computed(() => (tabs.value.some((t) => t.id === state.tab) ? state.tab : "overview"));
</script>

<template>
  <div v-if="!principal" class="placeholder">
    <Icon name="role" :size="36" />
    <p>Select a user or role.</p>
  </div>
  <div v-else class="detail">
    <header class="head">
      <div class="avatar" :class="principal.kind">
        <Icon :name="principal.system ? 'system' : principal.kind === 'user' ? 'user' : 'role'" :size="20" />
      </div>
      <div class="grow">
        <div class="row wrap title-row">
          <h1 :title="principal.name">{{ principal.name }}</h1>
          <span class="badge">{{ kindLabel }}</span>
          <span v-for="b in principal.badges" :key="b.label" class="badge" :class="b.tone" :title="b.title">{{ b.label }}</span>
        </div>
        <div v-if="principal.comment" class="comment">{{ principal.comment }}</div>
      </div>
      <div class="actions">
        <button class="btn" :disabled="principal.system" @click="m.openDialog({ type: 'edit' })">
          <Icon name="edit" :size="14" /> Edit
        </button>
        <button
          v-if="m.caps.value?.script"
          class="btn ghost icon-only"
          title="Duplicate"
          :disabled="principal.system || !state.detail"
          @click="m.openDialog({ type: 'duplicate' })"
        >
          <Icon name="copy" />
        </button>
        <button
          v-if="m.caps.value?.script"
          class="btn ghost icon-only"
          title="Show SQL script"
          :disabled="!state.detail"
          @click="m.openDialog({ type: 'script' })"
        >
          <Icon name="code" />
        </button>
        <button class="btn ghost icon-only danger" title="Drop" :disabled="principal.system" @click="m.openDialog({ type: 'drop' })">
          <Icon name="trash" />
        </button>
      </div>
    </header>

    <nav class="tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        role="tab"
        :aria-selected="activeTab === tab.id"
        :class="{ active: activeTab === tab.id }"
        @click="m.setTab(tab.id)"
      >
        {{ tab.label }}<span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
      </button>
    </nav>

    <div class="content">
      <div v-if="state.detailError" class="notice danger">
        <Icon name="fail" :size="14" />
        <span class="mono">{{ state.detailError }}</span>
      </div>
      <OverviewTab v-if="activeTab === 'overview'" :key="`o-${principal.id}`" />
      <MembershipsTab v-else-if="activeTab === 'memberships'" :key="`m-${principal.id}`" />
      <GrantsTab v-else-if="activeTab === 'grants'" :key="`g-${principal.id}`" />
      <EffectiveTab v-else-if="activeTab === 'effective'" :key="`e-${principal.id}`" />
      <SettingsTab v-else-if="activeTab === 'settings'" :key="`s-${principal.id}`" />
      <SessionsTab v-else-if="activeTab === 'sessions'" :key="`x-${principal.id}`" />
      <DebugTab v-else :key="`d-${principal.id}`" />
    </div>
  </div>
</template>

<style scoped>
.placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-lighter);
}
.detail {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px 10px;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: color-mix(in srgb, var(--brand-info) 16%, transparent);
  color: var(--brand-info);
}
.avatar.role {
  background: color-mix(in srgb, var(--brand-purple) 16%, transparent);
  color: var(--brand-purple);
}
.title-row {
  gap: 6px;
}
h1 {
  margin: 0 4px 0 0;
  font-size: 1.15rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.comment {
  margin-top: 3px;
  color: var(--text);
  font-size: 0.8125rem;
}
.actions {
  display: flex;
  gap: 4px;
  flex: none;
}
.btn.danger:hover:not(:disabled) {
  color: var(--brand-danger);
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  overflow-x: auto;
  flex: none;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 8px 10px 7px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-light);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.tabs button:hover {
  color: var(--text-dark);
}
.tabs button.active {
  color: var(--text-dark);
  border-bottom-color: var(--accent);
}
.tab-count {
  font-size: 0.6875rem;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--subtle);
  color: var(--text-light);
  line-height: 15px;
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
</style>
