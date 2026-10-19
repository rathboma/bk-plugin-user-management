<script setup lang="ts">
import { computed } from "vue";
import { useManager } from "../state/inject";
import type { DetailTab } from "../state/manager";
import Icon from "./Icon.vue";
import MenuButton from "./MenuButton.vue";
import PendingBar from "./PendingBar.vue";
import PrincipalIcon from "./PrincipalIcon.vue";
import OverviewTab from "./tabs/OverviewTab.vue";
import MembershipsTab from "./tabs/MembershipsTab.vue";
import GrantsTab from "./tabs/GrantsTab.vue";
import AccessTab from "./tabs/AccessTab.vue";
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
  return p.system ? `system ${kind.toLowerCase()}` : kind.toLowerCase();
});

const tabs = computed(() => {
  const caps = m.caps.value;
  const name = principal.value?.name;
  const memberCount = state.memberships.filter((x) => x.member === name || x.role === name).length;
  const list: { id: DetailTab; label: string; count?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "debug", label: "Debug" },
  ];
  if (caps?.memberships.supported) list.push({ id: "memberships", label: "Memberships", count: memberCount });
  list.push({
    id: "grants",
    label: "Direct grants",
    count: state.detail ? state.detail.grants.length + state.detail.defaultGrants.filter((d) => d.grantee === name).length : undefined,
  });
  list.push({ id: "access", label: "Access" });
  if (caps?.settings) list.push({ id: "settings", label: "Settings", count: state.detail?.settings.length });
  if (caps?.sessions) list.push({ id: "sessions", label: "Sessions", count: principal.value?.sessions });
  return list;
});

const activeTab = computed(() => (tabs.value.some((t) => t.id === state.tab) ? state.tab : "overview"));
const menu = computed(() => [
  {
    label: "Drop…",
    icon: "delete",
    danger: true,
    disabled: principal.value?.system,
    action: () => m.openDialog({ type: "drop" }),
  },
]);
const showPending = computed(() => state.pending.length > 0 && state.pendingFor === principal.value?.name);
</script>

<template>
  <div v-if="!principal" class="placeholder">
    <Icon name="manage_accounts" :size="36" />
    <p>Select a user or role.</p>
  </div>
  <div v-else class="detail">
    <header class="head">
      <div class="title-row">
        <PrincipalIcon :kind="principal.kind" :system="principal.system" :size="22" />
        <h1 :title="principal.name">{{ principal.name }}</h1>
        <span class="tag">{{ kindLabel }}</span>
        <span v-for="b in principal.badges" :key="b.label" class="tag" :class="b.tone" :title="b.title">{{ b.label }}</span>
        <span class="grow" />
        <div class="actions">
          <button class="btn" :disabled="principal.system" @click="m.openDialog({ type: 'edit' })"><Icon name="edit" />Edit</button>
          <button
            v-if="m.caps.value?.script"
            class="btn"
            :disabled="principal.system || !state.detail"
            @click="m.openDialog({ type: 'duplicate' })"
          >
            <Icon name="content_copy" />Duplicate
          </button>
          <button v-if="m.caps.value?.script" class="btn" :disabled="!state.detail" @click="m.openDialog({ type: 'script' })">
            <Icon name="code" />SQL script
          </button>
          <MenuButton :items="menu" title="More: Drop…" />
        </div>
      </div>
      <div v-if="principal.comment" class="comment">{{ principal.comment }}</div>
      <nav class="tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :class="{ active: activeTab === tab.id }"
          @click="m.setTab(tab.id)"
        >
          {{ tab.label }}<span v-if="tab.count" class="pill quiet">{{ tab.count }}</span>
        </button>
      </nav>
    </header>

    <div class="content">
      <div v-if="state.detailError" class="notice danger section">
        <Icon name="error" />
        <span class="mono">{{ state.detailError }}</span>
      </div>
      <OverviewTab v-if="activeTab === 'overview'" :key="`o-${principal.id}`" />
      <DebugTab v-else-if="activeTab === 'debug'" :key="`d-${principal.id}`" />
      <MembershipsTab v-else-if="activeTab === 'memberships'" :key="`m-${principal.id}`" />
      <GrantsTab v-else-if="activeTab === 'grants'" :key="`g-${principal.id}`" />
      <AccessTab v-else-if="activeTab === 'access'" :key="`a-${principal.id}`" />
      <SettingsTab v-else-if="activeTab === 'settings'" :key="`s-${principal.id}`" />
      <SessionsTab v-else :key="`x-${principal.id}`" />
    </div>
    <PendingBar v-if="showPending" />
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
  padding: 14px 20px 0;
  flex: none;
}
.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text-dark);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.comment {
  margin: 4px 0 0 32px;
  font-size: 13px;
  color: var(--text-light);
}
.tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  margin-top: 10px;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  margin-bottom: -1px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--text-light);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.tabs button:hover {
  color: var(--text-dark);
}
.tabs button.active {
  color: var(--text-dark);
  border-bottom-color: var(--accent);
}
.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}
@media (max-width: 1100px) {
  .actions .btn:not(.icon-only) {
    padding: 0 8px;
  }
}
</style>
