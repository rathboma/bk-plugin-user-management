<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { reachableRoles } from "../../core/graph";
import { formatTimestamp, relativeTime } from "../../core/format";
import type { Session } from "../../engines/types";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";
import PrincipalLink from "../PrincipalLink.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const canLogin = computed(() => principal.value?.attributes.login === true);
const sessions = computed(() => state.detail?.sessions ?? []);

const refreshing = ref(false);
const refreshedAt = ref(Date.now());
const now = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => clearInterval(timer));
const refreshedLabel = computed(() => {
  const minutes = Math.floor((now.value - refreshedAt.value) / 60_000);
  return minutes < 1 ? "refreshed just now" : minutes === 1 ? "refreshed 1 minute ago" : `refreshed ${minutes} minutes ago`;
});

async function refresh() {
  refreshing.value = true;
  try {
    await m.refresh();
    refreshedAt.value = now.value = Date.now();
  } finally {
    refreshing.value = false;
  }
}

/** Members, direct or through other roles, that are connected right now. */
const connectedMembers = computed(() => {
  const name = principal.value?.name;
  if (!name) return [];
  return state.principals.filter(
    (p) => p.sessions && p.name !== name && reachableRoles(p.name, state.memberships).has(name)
  );
});

function stateTone(s: Session) {
  if (s.state === "active") return "success";
  if (s.state?.startsWith("idle in")) return "warning";
  return "";
}

function terminate(list: Session[]) {
  const { engine, server } = m.need();
  m.review(engine.planTerminateSessions(list, server));
}

function openSessions(name: string) {
  const p = state.principals.find((x) => x.name === name);
  if (!p) return;
  void m.select(p.id).then(() => m.setTab("sessions"));
}
</script>

<template>
  <section class="section">
    <div class="section-head">
      <span class="title">Sessions</span>
      <span class="pill">{{ state.detail ? sessions.length : "…" }}</span>
      <span class="hint">
        Open connections for {{ principal?.name }} across the server<template v-if="canLogin"> · {{ refreshedLabel }}</template>
      </span>
      <button class="btn" :disabled="refreshing" @click="refresh">
        <span v-if="refreshing" class="spinner small" /><Icon v-else name="refresh" />Refresh
      </button>
      <button v-if="sessions.length > 1" class="btn" :disabled="m.readOnly.value" @click="terminate(sessions)">Terminate all</button>
    </div>

    <template v-if="state.detail && !sessions.length">
      <div v-if="!canLogin" class="box empty section">
        <div class="lead">{{ principal?.name }} can't log in, so it has no sessions of its own.</div>
        <div class="sub">Its members connect as themselves.</div>
      </div>
      <div v-else class="box empty section">
        <div class="lead">{{ principal?.name }} has no open sessions.</div>
      </div>

      <template v-if="connectedMembers.length">
        <div class="section-head">
          <span class="title">Members with open sessions</span>
          <span class="pill">{{ connectedMembers.length }}</span>
        </div>
        <div class="box">
          <div v-for="p in connectedMembers" :key="p.id" class="member-row">
            <PrincipalLink :name="p.name" />
            <span class="pill quiet"><i class="material-icons dot">circle</i>{{ p.sessions }}</span>
            <span class="grow" />
            <button class="link quiet" @click="openSessions(p.name)">Open {{ p.name }}'s sessions</button>
          </div>
        </div>
      </template>
    </template>

    <template v-else-if="state.detail">
      <div class="box">
        <table class="table fixed">
          <colgroup>
            <col style="width: 80px" />
            <col style="width: 120px" />
            <col style="width: 150px" />
            <col style="width: 140px" />
            <col style="width: 150px" />
            <col style="width: 110px" />
            <col />
            <col style="width: 100px" />
          </colgroup>
          <thead>
            <tr>
              <th>PID</th>
              <th>Database</th>
              <th>Client</th>
              <th>Application</th>
              <th>State</th>
              <th>Connected</th>
              <th>Last query</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sessions" :key="s.id">
              <td class="mono strong">{{ s.id }}</td>
              <td class="strong ellipsis">{{ s.database }}</td>
              <td class="mono client ellipsis" :title="s.client">{{ s.client }}</td>
              <td class="ellipsis" :title="s.application">{{ s.application ?? "" }}</td>
              <td><span class="tag" :class="stateTone(s)">{{ s.state ?? "unknown" }}</span></td>
              <td class="nowrap" :title="formatTimestamp(s.startedAt)">{{ relativeTime(s.startedAt) }}</td>
              <td class="mono query ellipsis" :title="s.query">{{ s.query }}</td>
              <td class="actions">
                <button class="btn small" :disabled="m.readOnly.value" @click="terminate([s])">Terminate</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="section-foot">Terminate opens the review dialog with the statement that ends the chosen sessions.</p>
    </template>
  </section>
</template>

<style scoped>
.section-head .hint {
  font-size: 12.5px;
}
.table td {
  color: var(--text);
}
.table td.strong {
  color: var(--text-dark);
}
.client,
.query {
  font-size: 12px;
}
.tag {
  text-transform: none;
}
.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
}
.member-row:last-child {
  border-bottom: 0;
}
.member-row:hover {
  background: var(--tint-1);
}
.member-row .link {
  font-size: 12.5px;
}
</style>
