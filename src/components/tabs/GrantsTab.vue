<script setup lang="ts">
import { computed } from "vue";
import { reachableRoles } from "../../core/graph";
import { objectLabel } from "../../core/objects";
import type { DefaultGrant, GrantChange, GrantEntry } from "../../engines/types";
import { useManager } from "../../state/inject";
import EntityIcon from "../EntityIcon.vue";
import Icon from "../Icon.vue";
import PrincipalLink from "../PrincipalLink.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;
const publicId = computed(() => m.caps.value?.publicGrantee?.id);

function typeLabel(type: string, subtype?: string) {
  if (subtype && subtype !== "system") return subtype;
  return m.caps.value?.objectTypes.find((t) => t.id === type)?.label.toLowerCase() ?? type;
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
  const groups = new Map<string, { first: DefaultGrant; privileges: { id: string; grantable: boolean }[] }>();
  for (const d of list) {
    const key = JSON.stringify([d.owner, d.schema ?? null, d.objectType, d.grantee]);
    if (!groups.has(key)) groups.set(key, { first: d, privileges: [] });
    groups.get(key)!.privileges.push({ id: d.privilege, grantable: d.grantable });
  }
  return [...groups.values()];
}

const receivedDefaults = computed(() => defaultGroups((state.detail?.defaultGrants ?? []).filter((d) => d.grantee === principal.value?.name)));
const givenDefaults = computed(() => defaultGroups((state.detail?.defaultGrants ?? []).filter((d) => d.owner === principal.value?.name)));

/** Roles whose privileges it uses, for the empty state. */
const throughRoles = computed(() => {
  if (!principal.value) return [];
  const reach = reachableRoles(principal.value.name, state.memberships, {
    inherits: (x) => x.options.inherit !== false,
    settable: (x) => x.options.set !== false,
  });
  return [...reach.values()].filter((r) => r.inherited).map((r) => r.role);
});

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

function revokeDefault(group: ReturnType<typeof defaultGroups>[number]) {
  const { engine, server } = m.need();
  const d = group.first;
  m.review(
    engine.planGrants(
      [
        {
          action: "revoke",
          target: { kind: "default", objectType: d.objectType, schema: d.schema, owner: d.owner },
          privileges: group.privileges.map((p) => p.id),
          grantee: d.grantee,
        },
      ],
      server
    )
  );
}

function explain(group: (typeof grantGroups.value)[number]) {
  if (!principal.value) return;
  void m.ask(principal.value.name, { object: group.first.object, privilege: group.privileges[0].id });
}
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <span class="title">Granted directly</span>
        <span class="pill">{{ grantGroups.length }}</span>
        <span class="hint">
          In {{ state.server?.database }}. Everything {{ principal?.name }} can do, through roles and PUBLIC too, is under
          <button class="link" @click="m.setTab('access')">Access</button>.
        </span>
        <button class="btn" :disabled="m.readOnly.value" @click="m.openDialog({ type: 'grant', grantee: principal?.name })">
          <Icon name="add" />Grant
        </button>
      </div>
      <div v-if="state.detailLoading && !state.detail" class="spinner" />
      <div v-else-if="!grantGroups.length" class="box empty">
        <div class="lead">Nothing is granted directly to {{ principal?.name }}.</div>
        <div class="sub">
          Everything {{ principal?.name }} can do comes through
          <template v-for="(role, i) in throughRoles" :key="role">
            <button class="link quiet" @click="m.select(role)">{{ role }}</button>{{ i < throughRoles.length - 1 ? ", " : "" }}
          </template>
          <template v-if="throughRoles.length"> and </template>PUBLIC. See
          <button class="link quiet" @click="m.setTab('access')">Access</button> for the full picture.
        </div>
      </div>
      <div v-else class="box">
        <table class="table">
          <thead>
            <tr>
              <th>Object</th>
              <th style="width: 110px">Type</th>
              <th style="width: 280px">Privileges</th>
              <th style="width: 150px">Granted by</th>
              <th style="width: 170px" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in grantGroups" :key="JSON.stringify([group.first.object, group.first.column])">
              <td>
                <span class="entity obj">
                  <EntityIcon :type="group.first.column ? 'column' : group.first.object.type" :subtype="group.first.object.subtype" />
                  {{ objectLabel(group.first.object) }}<span v-if="group.first.column" class="sub">({{ group.first.column }})</span>
                </span>
              </td>
              <td class="nowrap">{{ group.first.column ? "column" : typeLabel(group.first.object.type, group.first.object.subtype) }}</td>
              <td>
                <span class="privs">
                  <code
                    v-for="p in group.privileges"
                    :key="p.id"
                    class="inline-code"
                    :title="p.grantable ? 'With grant option: can grant it to others' : undefined"
                    >{{ p.id }}{{ p.grantable ? "*" : "" }}</code
                  >
                </span>
              </td>
              <td>{{ [...group.grantors].join(", ") }}</td>
              <td class="actions">
                <button class="btn quiet small" title="Open in Debug" @click="explain(group)"><Icon name="bug" />Explain</button>
                <button class="btn small" :disabled="m.readOnly.value" title="Revoke these privileges" @click="revoke(group)">Revoke</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="grantGroups.some((g) => g.privileges.some((p) => p.grantable))" class="section-foot">
        * with grant option: can grant it to others.
      </p>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="title">Default privileges it receives</span>
        <span class="pill">{{ receivedDefaults.length }}</span>
        <span class="hint">Granted automatically on objects created later</span>
        <button
          class="btn"
          :disabled="m.readOnly.value"
          @click="m.openDialog({ type: 'grant', grantee: principal?.name, target: 'default' })"
        >
          <Icon name="add" />Add default
        </button>
      </div>
      <div v-if="!receivedDefaults.length" class="empty-line">None.</div>
      <div v-else class="box">
        <div v-for="d in receivedDefaults" :key="JSON.stringify(d.first)" class="default-row">
          <code v-for="p in d.privileges" :key="p.id" class="inline-code">{{ p.id }}{{ p.grantable ? "*" : "" }}</code>
          <span class="muted">on {{ pluralType(d.first.objectType) }} created by</span>
          <PrincipalLink :name="d.first.owner" />
          <template v-if="d.first.schema">
            <span class="muted">in schema</span>
            <span class="entity obj"><EntityIcon type="schema" />{{ d.first.schema }}</span>
          </template>
          <span v-else class="muted">in any schema</span>
          <span class="grow" />
          <button class="btn small" :disabled="m.readOnly.value" @click="revokeDefault(d)">Revoke</button>
        </div>
      </div>
    </section>

    <section class="section">
      <div v-if="!givenDefaults.length" class="section-foot">
        Default privileges for objects {{ principal?.name }} creates: none.
      </div>
      <template v-else>
        <div class="section-head">
          <span class="title">Default privileges for objects it creates</span>
          <span class="pill">{{ givenDefaults.length }}</span>
        </div>
        <div class="box">
          <div v-for="d in givenDefaults" :key="JSON.stringify(d.first)" class="default-row">
            <code v-for="p in d.privileges" :key="p.id" class="inline-code">{{ p.id }}{{ p.grantable ? "*" : "" }}</code>
            <span class="muted">on {{ pluralType(d.first.objectType) }}</span>
            <template v-if="d.first.schema">
              <span class="muted">in schema</span>
              <span class="entity obj"><EntityIcon type="schema" />{{ d.first.schema }}</span>
            </template>
            <span v-else class="muted">in any schema</span>
            <span class="muted">to</span>
            <span v-if="d.first.grantee === publicId" class="entity">PUBLIC</span>
            <PrincipalLink v-else :name="d.first.grantee" />
            <span class="grow" />
            <button class="btn small" :disabled="m.readOnly.value" @click="revokeDefault(d)">Revoke</button>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.section-head .hint {
  font-size: 12.5px;
}
.section-head .hint .link {
  color: var(--text-dark);
}
.table td:first-child {
  color: var(--text-dark);
}
.privs {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.inline-code {
  padding: 2px 6px;
}
.default-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
  color: var(--text-dark);
}
.default-row:last-child {
  border-bottom: 0;
}
.default-row:hover {
  background: var(--tint-1);
}
.default-row .muted {
  color: var(--text);
}
.section-foot {
  font-size: 12.5px;
}
</style>
