<script setup lang="ts">
import { computed } from "vue";
import { formatTimestamp, relativeTime } from "../../core/format";
import { objectKey, objectLabel } from "../../core/objects";
import type { AttributeDef, OwnedObject } from "../../engines/types";
import { useManager } from "../../state/inject";
import EntityIcon from "../EntityIcon.vue";
import Icon from "../Icon.vue";
import PrincipalLink from "../PrincipalLink.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

interface Row {
  label: string;
  title?: string;
  text: string;
  tone: "on" | "off" | "danger";
  hint?: string;
}

function display(def: AttributeDef): Row {
  const value = principal.value?.attributes[def.id];
  const row = { label: def.label, title: def.description };
  if (def.type === "boolean") {
    return value ? { ...row, text: "Yes", tone: def.dangerous ? "danger" : "on" } : { ...row, text: "No", tone: "off" };
  }
  if (def.type === "datetime") {
    if (!value) return { ...row, text: def.placeholder ?? "—", tone: "off" };
    return { ...row, text: formatTimestamp(String(value)), tone: "on", hint: relativeTime(String(value)) };
  }
  if (def.id === "connectionLimit" && value === -1) return { ...row, text: "No limit", tone: "off" };
  if (def.type === "select") return { ...row, text: def.options?.find((o) => o.value === value)?.label ?? String(value ?? ""), tone: "on" };
  if (value === null || value === undefined || value === "") return { ...row, text: "—", tone: "off" };
  return { ...row, text: String(value), tone: "on" };
}

const passwordRow = computed((): Row | undefined => {
  const p = principal.value;
  if (!p || !m.caps.value?.password.supported) return undefined;
  const s = p.passwordState;
  if (!s || s === "none") return { label: "Password", text: "None", tone: "off" };
  if (s === "unknown") return { label: "Password", text: "Hidden", tone: "off", hint: "Only superusers can read password hashes" };
  if (s === "set") return { label: "Password", text: "Set", tone: "on" };
  return { label: "Password", text: s.toUpperCase(), tone: "on" };
});

/** Can this kind of principal log in at all, e.g. a group role can't. */
const canLogin = computed(() => principal.value?.attributes.login === true);

const loginRows = computed(() => {
  const p = principal.value;
  const defs = (m.caps.value?.attributes ?? []).filter((a) => a.group === "Login");
  const rows: Row[] = [];
  for (const def of defs) {
    if (!def.kinds || (p && def.kinds.includes(p.kind))) rows.push(display(def));
    if (def.id === "login" && passwordRow.value) rows.push(passwordRow.value);
  }
  if (p && !canLogin.value && !defs.some((d) => d.id === "connectionLimit" && (!d.kinds || d.kinds.includes(p.kind)))) {
    rows.push({ label: "Connection limit", text: "—", tone: "off" });
  }
  return rows;
});

const privilegeRows = computed(() => {
  const p = principal.value;
  return (m.caps.value?.attributes ?? [])
    .filter((a) => a.group !== "Login" && (!a.kinds || (p && a.kinds.includes(p.kind))))
    .map(display);
});

const memberOf = computed(() => state.memberships.filter((x) => x.member === principal.value?.name));
const members = computed(() => state.memberships.filter((x) => x.role === principal.value?.name));
const directGrants = computed(() => state.detail?.grants.length);
const sessionApps = computed(() => {
  const apps = [...new Set((state.detail?.sessions ?? []).map((s) => s.application).filter((a): a is string => !!a))];
  return apps.length > 2 ? `${apps.slice(0, 2).join(", ")}…` : apps.join(", ");
});

const TYPE_ORDER = ["database", "schema", "table", "sequence", "function"];
const SUBTYPE_ORDER = ["table", "view", "materialized view", "foreign table", "partitioned table"];
/** Containers first, then tables, views and the rest, e.g. schemas before the tables in them. */
const owned = computed(() => {
  const order = [...TYPE_ORDER, ...(m.caps.value?.objectTypes ?? []).map((t) => t.id).filter((id) => !TYPE_ORDER.includes(id))];
  const rank = (o: OwnedObject) => [
    order.indexOf(o.type) === -1 ? order.length : order.indexOf(o.type),
    o.subtype ? SUBTYPE_ORDER.indexOf(o.subtype) : 0,
  ];
  return [...(state.detail?.owned ?? [])].sort((a, b) => {
    const [ta, sa] = rank(a);
    const [tb, sb] = rank(b);
    return ta - tb || sa - sb || objectLabel(a).localeCompare(objectLabel(b));
  });
});
const typeLabel = (o: OwnedObject) => o.subtype && o.subtype !== "system" ? o.subtype : o.type;
const ownedTags = computed(() => {
  const counts = new Map<string, number>();
  for (const o of owned.value) counts.set(typeLabel(o), (counts.get(typeLabel(o)) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => `${n} ${type}${n === 1 ? "" : "s"}`);
});
/** Types the Who can access view lists. */
const accessTypes = computed(() => new Set((m.caps.value?.objectTypes ?? []).filter((t) => t.browse || t.id === "type").map((t) => t.id)));
const publicId = computed(() => m.caps.value?.publicGrantee?.id);
const grantee = (name: string) => (name === publicId.value ? "PUBLIC" : name);

/** "USAGE to app_readers, app_writers", "2 roles", "None", plus policies. */
function grantSummary(o: OwnedObject): string {
  const parts: string[] = [];
  if (!o.grants.length) parts.push("None");
  else {
    const privileges = new Set(o.grants.map((g) => g.privileges.join(", ")));
    if (privileges.size === 1 && o.grants.length <= 3) {
      parts.push(`${[...privileges][0]} to ${o.grants.map((g) => grantee(g.grantee)).join(", ")}`);
    } else {
      parts.push(o.grants.length === 1 ? "1 role" : `${o.grants.length} roles`);
    }
  }
  if (o.policies) parts.push(o.policies === 1 ? "1 policy" : `${o.policies} policies`);
  return parts.join(" · ");
}

function grantTitle(o: OwnedObject): string {
  return o.grants.map((g) => `${grantee(g.grantee)}: ${g.privileges.join(", ")}`).join("\n");
}
</script>

<template>
  <div class="overview">
    <div class="cards">
      <section class="card">
        <h3>Login</h3>
        <div v-for="row in loginRows" :key="row.label" class="kv">
          <span class="k" :title="row.title">{{ row.label }}</span>
          <span class="v" :class="row.tone" :title="row.hint">{{ row.text }}</span>
        </div>
        <p v-if="principal && !canLogin" class="note">
          A group role. Members log in as themselves and use its privileges.
        </p>
      </section>

      <section class="card">
        <h3>Privileges</h3>
        <div v-for="row in privilegeRows" :key="row.label" class="kv">
          <span class="k" :title="row.title">{{ row.label }}</span>
          <span class="v" :class="row.tone">{{ row.text }}</span>
        </div>
      </section>

      <section class="card">
        <h3>Relationships</h3>
        <div class="kv">
          <span class="k">Member of</span>
          <span v-if="memberOf.length" class="v links">
            <PrincipalLink v-for="x in memberOf.slice(0, 3)" :key="x.role + x.grantor" :name="x.role" :size="14" />
            <button v-if="memberOf.length > 3" class="link quiet" @click="m.setTab('memberships')">+{{ memberOf.length - 3 }}</button>
          </span>
          <span v-else class="v off">None</span>
        </div>
        <div class="kv">
          <span class="k">Members</span>
          <span v-if="members.length" class="v links">
            <PrincipalLink v-for="x in members.slice(0, 3)" :key="x.member + x.grantor" :name="x.member" :size="14" />
            <button v-if="members.length > 3" class="link quiet" @click="m.setTab('memberships')">+{{ members.length - 3 }}</button>
          </span>
          <span v-else class="v off">None</span>
        </div>
        <div class="kv">
          <span class="k">Direct grants</span>
          <button v-if="directGrants" class="v link" @click="m.setTab('grants')">{{ directGrants }}</button>
          <span v-else class="v off">{{ directGrants ?? "…" }}</span>
        </div>
        <div v-if="m.caps.value?.sessions" class="kv">
          <span class="k">Open sessions</span>
          <button v-if="principal?.sessions" class="v link sessions" @click="m.setTab('sessions')">
            <Icon name="circle" :size="10" color="var(--brand-success)" />{{ principal.sessions
            }}<template v-if="sessionApps"> · {{ sessionApps }}</template>
          </button>
          <span v-else class="v off">—</span>
        </div>
      </section>
    </div>

    <div class="section-head">
      <span class="title">Owns</span>
      <span class="pill">{{ state.detail ? owned.length : "…" }}{{ state.detail?.ownedTruncated ? "+" : "" }}</span>
      <span v-for="t in ownedTags" :key="t" class="tag quiet">{{ t }}</span>
      <span class="hint">
        {{ owned.length ? `In ${state.server?.database}. Owners have every privilege on their objects.` : `In ${state.server?.database}, plus other databases on this server` }}
      </span>
    </div>
    <div v-if="state.detailLoading && !state.detail" class="spinner" />
    <div v-else-if="state.detail && !owned.length" class="empty-line">{{ principal?.name }} owns nothing.</div>
    <div v-else-if="owned.length" class="box">
      <table class="table">
        <thead>
          <tr>
            <th>Object</th>
            <th style="width: 180px">Type</th>
            <th style="width: 220px">Grants on it</th>
            <th style="width: 150px" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in owned" :key="objectKey(o)">
            <td>
              <span class="entity obj">
                <EntityIcon :type="o.type" :subtype="o.subtype" />{{ objectLabel(o) }}
              </span>
            </td>
            <td>{{ typeLabel(o) }}</td>
            <td :title="grantTitle(o)">{{ grantSummary(o) }}</td>
            <td class="actions">
              <button v-if="accessTypes.has(o.type)" class="btn quiet small" @click="m.showObject(o)">
                <Icon name="grid_on" />Who can access…
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--raised);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
  padding: 14px 20px;
}
.card + .card {
  border-left: 1px solid var(--line);
}
h3 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-light);
}
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  min-width: 0;
}
.k {
  color: var(--text);
  white-space: nowrap;
  cursor: default;
}
.v {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dark);
}
.v.off {
  color: var(--text-lighter);
}
.v.danger {
  color: var(--brand-danger);
}
.v.links {
  display: inline-flex;
  gap: 10px;
}
button.v {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
}
.sessions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.note {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-lighter);
  text-wrap: pretty;
}
.section-head .hint {
  margin-left: 4px;
  font-size: 12.5px;
}
@media (max-width: 900px) {
  .cards {
    grid-template-columns: 1fr;
  }
  .card + .card {
    border-left: 0;
    border-top: 1px solid var(--line);
  }
}
</style>
