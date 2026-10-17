<script setup lang="ts">
import { computed } from "vue";
import { objectLabel } from "../../core/objects";
import type { DefaultGrant, GrantEntry, GrantChange } from "../../engines/types";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

function typeLabel(type: string, subtype?: string) {
  return subtype ?? m.caps.value?.objectTypes.find((t) => t.id === type)?.label.toLowerCase() ?? type;
}

const grantGroups = computed(() => {
  const groups = new Map<string, { first: GrantEntry; privileges: { id: string; grantable: boolean }[]; grantors: Set<string> }>();
  for (const g of state.detail?.grants ?? []) {
    const key = JSON.stringify([g.object.type, g.object.schema, g.object.name, g.object.signature, g.column ?? null]);
    if (!groups.has(key)) groups.set(key, { first: g, privileges: [], grantors: new Set() });
    const group = groups.get(key)!;
    group.privileges.push({ id: g.privilege, grantable: g.grantable });
    if (g.grantor) group.grantors.add(g.grantor);
  }
  return [...groups.values()];
});

function defaultGroups(list: DefaultGrant[]) {
  const groups = new Map<string, { first: DefaultGrant; privileges: string[] }>();
  for (const d of list) {
    const key = JSON.stringify([d.owner, d.schema ?? null, d.objectType, d.grantee]);
    if (!groups.has(key)) groups.set(key, { first: d, privileges: [] });
    groups.get(key)!.privileges.push(d.privilege + (d.grantable ? "*" : ""));
  }
  return [...groups.values()];
}

const receivedDefaults = computed(() => defaultGroups((state.detail?.defaultGrants ?? []).filter((d) => d.grantee === principal.value?.name)));
const givenDefaults = computed(() => defaultGroups((state.detail?.defaultGrants ?? []).filter((d) => d.owner === principal.value?.name)));

function pluralType(type: string) {
  return m.caps.value?.objectTypes.find((t) => t.id === type)?.plural.toLowerCase() ?? type;
}

function revoke(group: (typeof grantGroups.value)[number]) {
  const { engine, server } = m.need();
  const g = group.first;
  const change: GrantChange = {
    action: "revoke",
    target: { kind: "object", object: g.object, columns: g.column ? [g.column] : undefined },
    privileges: group.privileges.map((p) => p.id),
    grantee: g.grantee,
  };
  m.review(engine.planGrants([change], server));
}

function revokeDefault(group: { first: DefaultGrant; privileges: string[] }) {
  const { engine, server } = m.need();
  const d = group.first;
  m.review(
    engine.planGrants(
      [
        {
          action: "revoke",
          target: { kind: "default", objectType: d.objectType, schema: d.schema, owner: d.owner },
          privileges: group.privileges.map((p) => p.replace(/\*$/, "")),
          grantee: d.grantee,
        },
      ],
      server
    )
  );
}

function check(group: (typeof grantGroups.value)[number]) {
  if (!principal.value) return;
  m.ask(principal.value.name, { object: group.first.object, privilege: group.privileges[0].id });
}
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <h3>Granted directly <span class="count">{{ grantGroups.length }}</span></h3>
        <span class="hint">in {{ state.server?.database }}. Privileges through roles and PUBLIC are under Effective access.</span>
        <div class="grow" />
        <button class="btn" @click="m.openDialog({ type: 'grant', grantee: principal?.name })">
          <Icon name="plus" :size="14" /> Grant
        </button>
      </div>
      <div v-if="state.detailLoading && !state.detail" class="spinner" />
      <div v-else-if="!grantGroups.length" class="empty-note">No privileges granted directly to {{ principal?.name }}.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Object</th>
              <th>Type</th>
              <th>Privileges</th>
              <th>Granted by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in grantGroups" :key="JSON.stringify([group.first.object, group.first.column])">
              <td class="mono">
                {{ objectLabel(group.first.object) }}<span v-if="group.first.column" class="muted"> ({{ group.first.column }})</span>
              </td>
              <td class="muted nowrap">{{ group.first.column ? "column" : typeLabel(group.first.object.type, group.first.object.subtype) }}</td>
              <td>
                <span class="row wrap privs">
                  <span
                    v-for="p in group.privileges"
                    :key="p.id"
                    class="badge"
                    :class="{ info: p.grantable }"
                    :title="p.grantable ? 'With grant option' : undefined"
                    >{{ p.id }}{{ p.grantable ? "*" : "" }}</span
                  >
                </span>
              </td>
              <td class="muted">{{ [...group.grantors].join(", ") }}</td>
              <td class="actions">
                <button class="btn ghost icon-only" title="Explain access" @click="check(group)"><Icon name="bug" :size="14" /></button>
                <button class="btn ghost" title="Revoke these privileges" @click="revoke(group)">Revoke</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="grantGroups.some((g) => g.privileges.some((p) => p.grantable))" class="hint">* with grant option: can grant it to others.</p>
    </section>

    <section class="section">
      <div class="section-head">
        <h3>Default privileges it receives <span class="count">{{ receivedDefaults.length }}</span></h3>
        <span class="hint">Granted automatically on objects created later</span>
        <div class="grow" />
        <button class="btn" @click="m.openDialog({ type: 'grant', grantee: principal?.name, target: 'default' })">
          <Icon name="plus" :size="14" /> Add default
        </button>
      </div>
      <div v-if="!receivedDefaults.length" class="empty-note">
        No default privileges are granted to {{ principal?.name }} directly.
      </div>
      <ul v-else class="defaults">
        <li v-for="d in receivedDefaults" :key="JSON.stringify(d.first)">
          <span class="grow">
            <strong>{{ d.privileges.join(", ") }}</strong> on {{ pluralType(d.first.objectType) }} created by
            <button class="link" @click="m.select(d.first.owner)">{{ d.first.owner }}</button>
            {{ d.first.schema ? `in schema ${d.first.schema}` : "in any schema" }}
          </span>
          <button class="btn ghost" @click="revokeDefault(d)">Revoke</button>
        </li>
      </ul>
    </section>

    <section v-if="givenDefaults.length" class="section">
      <div class="section-head">
        <h3>Default privileges for objects it creates <span class="count">{{ givenDefaults.length }}</span></h3>
      </div>
      <ul class="defaults">
        <li v-for="d in givenDefaults" :key="JSON.stringify(d.first)">
          <span class="grow">
            <strong>{{ d.privileges.join(", ") }}</strong> on {{ pluralType(d.first.objectType) }}
            {{ d.first.schema ? `in schema ${d.first.schema}` : "in any schema" }} to
            <button v-if="d.first.grantee !== 'public'" class="link" @click="m.select(d.first.grantee)">{{ d.first.grantee }}</button>
            <span v-else>PUBLIC</span>
          </span>
          <button class="btn ghost" @click="revokeDefault(d)">Revoke</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.privs {
  gap: 4px;
}
.defaults {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  background: var(--raised);
}
.defaults li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
  font-size: 0.8125rem;
}
.defaults li:last-child {
  border-bottom: 0;
}
</style>
