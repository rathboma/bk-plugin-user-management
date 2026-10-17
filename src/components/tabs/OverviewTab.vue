<script setup lang="ts">
import { computed } from "vue";
import { formatTimestamp, relativeTime } from "../../core/format";
import type { AttributeDef } from "../../engines/types";
import { useManager } from "../../state/inject";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const groups = computed(() => {
  const p = principal.value;
  const defs = (m.caps.value?.attributes ?? []).filter((a) => !a.kinds || (p && a.kinds.includes(p.kind)));
  const byGroup = new Map<string, AttributeDef[]>();
  for (const def of defs) {
    if (!byGroup.has(def.group)) byGroup.set(def.group, []);
    byGroup.get(def.group)!.push(def);
  }
  return [...byGroup.entries()];
});

function display(def: AttributeDef): { text: string; tone?: string; title?: string } {
  const value = principal.value?.attributes[def.id];
  if (def.type === "boolean") {
    return value ? { text: "Yes", tone: def.dangerous ? "danger" : "on" } : { text: "No", tone: "off" };
  }
  if (def.type === "datetime") {
    if (!value) return { text: def.placeholder ?? "—", tone: "off" };
    return { text: formatTimestamp(String(value)), title: relativeTime(String(value)) };
  }
  if (def.id === "connectionLimit" && value === -1) return { text: "No limit", tone: "off" };
  if (def.type === "select") return { text: def.options?.find((o) => o.value === value)?.label ?? String(value ?? "") };
  return { text: value === null || value === undefined || value === "" ? "—" : String(value) };
}

const passwordLabel = computed(() => {
  const s = principal.value?.passwordState;
  if (!s || s === "unknown") return "Hidden (superusers only)";
  if (s === "none") return "Not set";
  if (s === "set") return "Set";
  return `Set (${s.toUpperCase()})`;
});

const memberOf = computed(() => state.memberships.filter((x) => x.member === principal.value?.name));
const members = computed(() => state.memberships.filter((x) => x.role === principal.value?.name));
const ownedByType = computed(() => {
  const counts = new Map<string, number>();
  for (const o of state.detail?.owned ?? []) counts.set(o.subtype ?? o.type, (counts.get(o.subtype ?? o.type) ?? 0) + 1);
  return [...counts.entries()];
});
</script>

<template>
  <div class="overview">
    <div class="grid">
      <section v-for="[group, defs] in groups" :key="group" class="card">
        <h3>{{ group }}</h3>
        <dl>
          <template v-for="def in defs" :key="def.id">
            <dt :title="def.description">{{ def.label }}</dt>
            <dd :class="display(def).tone" :title="display(def).title">{{ display(def).text }}</dd>
          </template>
          <template v-if="group === 'Login' && m.caps.value?.password.supported && principal?.kind === 'user'">
            <dt>Password</dt>
            <dd :class="{ off: principal?.passwordState === 'none' || principal?.passwordState === 'unknown' }">{{ passwordLabel }}</dd>
          </template>
        </dl>
      </section>

      <section class="card">
        <h3>Relationships</h3>
        <dl>
          <dt>Member of</dt>
          <dd>
            <template v-if="memberOf.length">
              <button v-for="x in memberOf" :key="x.role + x.grantor" class="link" @click="m.select(x.role)">{{ x.role }}</button>
            </template>
            <span v-else class="off">None</span>
          </dd>
          <dt>Members</dt>
          <dd>
            <template v-if="members.length">
              <button v-for="x in members.slice(0, 12)" :key="x.member + x.grantor" class="link" @click="m.select(x.member)">{{ x.member }}</button>
              <span v-if="members.length > 12" class="muted">+{{ members.length - 12 }} more</span>
            </template>
            <span v-else class="off">None</span>
          </dd>
          <dt>Direct grants</dt>
          <dd>
            <button class="link" @click="m.setTab('grants')">{{ state.detail?.grants.length ?? "…" }}</button>
          </dd>
          <dt>Open sessions</dt>
          <dd>
            <button v-if="principal?.sessions" class="link" @click="m.setTab('sessions')">{{ principal.sessions }}</button>
            <span v-else class="off">None</span>
          </dd>
        </dl>
      </section>
    </div>

    <section class="section">
      <div class="section-head">
        <h3>Owns <span class="count">{{ state.detail?.owned.length ?? "…" }}{{ state.detail?.ownedTruncated ? "+" : "" }}</span></h3>
        <span class="hint">in {{ state.server?.database }}, plus any databases</span>
      </div>
      <div v-if="state.detailLoading && !state.detail" class="spinner" />
      <div v-else-if="!state.detail?.owned.length" class="empty-note">Doesn't own anything here.</div>
      <template v-else>
        <div class="row wrap owned-summary">
          <span v-for="[type, count] in ownedByType" :key="type" class="badge">{{ count }} {{ type }}</span>
        </div>
        <div class="table-wrap owned">
          <table class="table">
            <thead>
              <tr><th>Type</th><th>Name</th></tr>
            </thead>
            <tbody>
              <tr v-for="o in state.detail.owned" :key="`${o.type}:${o.schema}.${o.name}(${o.signature})`">
                <td class="muted nowrap">{{ o.subtype ?? o.type }}</td>
                <td class="mono">{{ o.schema ? `${o.schema}.` : "" }}{{ o.name }}<span v-if="o.type === 'function'" class="muted">({{ o.signature }})</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  margin-bottom: 22px;
}
h3 {
  margin: 0 0 8px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}
dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 14px;
  margin: 0;
  font-size: 0.8125rem;
}
dt {
  color: var(--text);
  cursor: default;
}
dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-weight: 500;
}
dd.off,
.off {
  color: var(--text-lighter);
  font-weight: 400;
}
dd.on {
  color: var(--brand-success);
}
dd.danger {
  color: var(--brand-danger);
}
.owned-summary {
  margin-bottom: 8px;
}
.owned {
  max-height: 260px;
}
</style>
