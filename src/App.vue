<script setup lang="ts">
import { onMounted, provide } from "vue";
import Icon from "./components/Icon.vue";
import PrincipalList from "./components/PrincipalList.vue";
import PrincipalDetail from "./components/PrincipalDetail.vue";
import ObjectAccessPanel from "./components/ObjectAccessPanel.vue";
import ReviewDialog from "./components/dialogs/ReviewDialog.vue";
import PrincipalEditor from "./components/dialogs/PrincipalEditor.vue";
import DropDialog from "./components/dialogs/DropDialog.vue";
import GrantDialog from "./components/dialogs/GrantDialog.vue";
import MembershipDialog from "./components/dialogs/MembershipDialog.vue";
import ScriptDialog from "./components/dialogs/ScriptDialog.vue";
import { createManager } from "./state/manager";
import { ManagerKey } from "./state/inject";
import { host } from "./host/host";
import { launchInput } from "./host/launch";
import { databaseName, supportedDatabaseNames } from "./engines/registry";

const m = createManager(host);
provide(ManagerKey, m);
const { state } = m;

function start() {
  void m.init(async () => launchInput(await host.viewContext()));
}

onMounted(start);
</script>

<template>
  <div class="app">
    <div v-if="state.status === 'loading'" class="status">
      <div class="spinner" />
    </div>

    <div v-else-if="state.status !== 'ready'" class="empty">
      <Icon name="manage_accounts" :size="40" class="empty-icon" />
      <template v-if="state.status === 'unsupported'">
        <h1>{{ databaseName(state.connection?.databaseType) }} isn't supported yet</h1>
        <p>User Management supports {{ supportedDatabaseNames() }}. More databases are planned.</p>
      </template>
      <template v-else-if="state.status === 'disconnected'">
        <h1>Not connected</h1>
        <p>Connect to a database to manage its users and roles.</p>
      </template>
      <template v-else>
        <h1>Couldn't load users and roles</h1>
        <p class="mono error-text">{{ state.error }}</p>
        <button class="btn" @click="start">
          <Icon name="refresh" />Try again
        </button>
      </template>
    </div>

    <template v-else>
      <header class="topbar">
        <div class="segmented" role="tablist">
          <button
            role="tab"
            :class="{ active: state.view === 'principals' }"
            :aria-selected="state.view === 'principals'"
            @click="m.select(state.selected)"
          >
            <Icon name="group" /> Users &amp; roles
          </button>
          <button
            role="tab"
            :class="{ active: state.view === 'object' }"
            :aria-selected="state.view === 'object'"
            @click="m.showObject(undefined)"
          >
            <Icon name="grid_on" /> Who can access…
          </button>
        </div>
        <div class="grow" />
        <span class="server" :title="`Connected to ${state.server?.database} as ${state.server?.currentUser}`">
          <Icon name="storage" :size="14" />{{ state.server?.versionLabel }} · {{ state.server?.database }}
        </span>
        <span class="server">as <span class="strong">{{ state.server?.currentUser }}</span></span>
        <span v-if="state.server?.isSuperuser" class="tag danger">superuser</span>
        <button class="btn quiet icon-only" title="Refresh" :disabled="state.loadingList" @click="m.refresh()">
          <Icon name="refresh" />
        </button>
      </header>

      <div v-if="m.readOnly.value" class="banner notice warning">
        <Icon name="lock" />
        <span>Read-only connection. Changes can be reviewed and copied, but not applied here.</span>
      </div>
      <div v-else-if="state.server && !state.server.canManagePrincipals" class="banner notice">
        <Icon name="info" />
        <span>
          {{ state.server.currentUser }} has neither SUPERUSER nor CREATEROLE, so creating and changing roles will fail.
          Granting privileges on objects it owns still works.
        </span>
      </div>

      <div class="body">
        <PrincipalList />
        <main class="main">
          <ObjectAccessPanel v-if="state.view === 'object'" />
          <PrincipalDetail v-else />
        </main>
      </div>
    </template>

    <PrincipalEditor v-if="state.dialog?.type === 'create' || state.dialog?.type === 'edit'" :key="state.dialog.type" />
    <DropDialog v-else-if="state.dialog?.type === 'drop'" />
    <GrantDialog v-else-if="state.dialog?.type === 'grant'" />
    <MembershipDialog v-else-if="state.dialog?.type === 'membership'" />
    <ScriptDialog v-else-if="state.dialog?.type === 'script' || state.dialog?.type === 'duplicate'" />
    <ReviewDialog v-if="state.review" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.status,
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
}
.empty h1 {
  margin: 0;
  font-size: 1.05rem;
}
.empty p {
  margin: 0;
  max-width: 460px;
  color: var(--text);
}
.empty-icon {
  color: var(--text-lighter);
}
.error-text {
  color: var(--brand-danger);
  white-space: pre-wrap;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line-soft);
  flex: none;
}
.server {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-light);
  white-space: nowrap;
  overflow: hidden;
}
.banner {
  margin: 8px 12px 0;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
@media (max-width: 760px) {
  .server {
    display: none;
  }
}
</style>
