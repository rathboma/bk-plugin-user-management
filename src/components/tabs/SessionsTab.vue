<script setup lang="ts">
import { formatTimestamp, relativeTime } from "../../core/format";
import type { Session } from "../../engines/types";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

function terminate(sessions: Session[]) {
  const { engine, server } = m.need();
  m.review(engine.planTerminateSessions(sessions, server));
}
</script>

<template>
  <section class="section">
    <div class="section-head">
      <h3>Open sessions <span class="count">{{ state.detail?.sessions.length ?? "…" }}</span></h3>
      <span class="hint">Across every database on the server</span>
      <div class="grow" />
      <button class="btn ghost icon-only" title="Refresh" @click="m.refresh()"><Icon name="refresh" :size="14" /></button>
      <button v-if="(state.detail?.sessions.length ?? 0) > 1" class="btn" @click="terminate(state.detail!.sessions)">Terminate all</button>
    </div>
    <div v-if="state.detail && !state.detail.sessions.length" class="empty-note">{{ principal?.name }} has no open sessions.</div>
    <div v-else-if="state.detail" class="table-wrap">
      <table class="table">
        <thead>
          <tr><th>PID</th><th>Database</th><th>Client</th><th>Application</th><th>State</th><th>Connected</th><th>Last query</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="s in state.detail.sessions" :key="s.id">
            <td class="mono">{{ s.id }}</td>
            <td>{{ s.database }}</td>
            <td class="mono">{{ s.client }}</td>
            <td>{{ s.application ?? "" }}</td>
            <td><span class="badge" :class="{ success: s.state === 'active', warning: s.state?.startsWith('idle in') }">{{ s.state ?? "?" }}</span></td>
            <td class="nowrap" :title="formatTimestamp(s.startedAt)">{{ relativeTime(s.startedAt) }}</td>
            <td class="mono query" :title="s.query">{{ s.query }}</td>
            <td class="actions"><button class="btn ghost" @click="terminate([s])">Terminate</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.query {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}
</style>
