<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { objectLabel } from "../../core/objects";
import type { EffectivePrivileges, ObjectPrivileges } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import EntityIcon from "../EntityIcon.vue";
import Icon from "../Icon.vue";
import SourceChip from "../SourceChip.vue";
import SourceLegend from "../SourceLegend.vue";
import UiSelect from "../UiSelect.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const types = computed(() => (m.caps.value?.objectTypes ?? []).filter((t) => t.browse));
const type = ref(types.value[0]?.id ?? "");
const schemas = ref<string[]>([]);
const schema = ref("");
const onlyAllowed = ref(false);
const filter = ref("");
const loading = ref(false);
const error = ref("");
const result = shallowRef<EffectivePrivileges>();
let request = 0;

const typeDef = computed(() => types.value.find((t) => t.id === type.value));
const privileges = computed(() => result.value?.objectType.privileges ?? []);
/** Narrow columns when there are many privileges, wide enough for the longest name. */
const columnWidth = computed(() => {
  const longest = Math.max(0, ...privileges.value.map((p) => p.id.length));
  return `${Math.max(privileges.value.length > 4 ? 78 : 120, Math.ceil(longest * 7.6 + 10))}px`;
});

async function load() {
  if (!principal.value || !type.value) return;
  const { engine, server } = m.need();
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const data = await engine.effectivePrivileges(
      m.run,
      server,
      m.ctx.value,
      principal.value.name,
      type.value,
      typeDef.value?.schemaScoped && schema.value ? schema.value : undefined
    );
    if (current === request) result.value = data;
  } catch (e) {
    if (current === request) {
      error.value = errorMessage(e);
      result.value = undefined;
    }
  } finally {
    if (current === request) loading.value = false;
  }
}

const rows = computed(() => {
  const term = filter.value.trim().toLowerCase();
  return (result.value?.rows ?? []).filter(
    (r) =>
      (!term || objectLabel(r.object).toLowerCase().includes(term)) &&
      (!onlyAllowed.value || Object.values(r.cells).some((c) => c.allowed))
  );
});

const footer = computed(() => {
  const def = result.value?.objectType;
  if (!def) return "";
  const count = rows.value.length;
  const noun = count === 1 ? def.label.toLowerCase() : def.plural.toLowerCase();
  let where = ` in ${state.server?.database}`;
  if (def.schemaScoped) {
    const inSchemas = [...new Set(rows.value.map((r) => r.object.schema).filter((s): s is string => !!s))];
    where = !inSchemas.length ? "" : inSchemas.length <= 3 ? ` in ${inSchemas.join(", ").replace(/, ([^,]*)$/, " and $1")}` : ` in ${inSchemas.length} schemas`;
  }
  return `${count} ${noun}${where}.`;
});

function explain(row: ObjectPrivileges, privilege: string) {
  if (principal.value) void m.ask(principal.value.name, { object: row.object, privilege });
}

function setType(value: string) {
  type.value = value;
  result.value = undefined;
}

onMounted(async () => {
  const { engine, server } = m.need();
  schemas.value = await engine.listSchemas(m.run, server).catch(() => []);
  await load();
});
watch([type, schema], load);
watch(() => state.revision, load);
</script>

<template>
  <div class="access">
    <div class="toolbar">
      <div class="segmented">
        <button v-for="t in types" :key="t.id" :class="{ active: type === t.id }" @click="setType(t.id)">{{ t.plural }}</button>
      </div>
      <UiSelect v-if="typeDef?.schemaScoped" v-model="schema" label="Schema">
        <option value="">All schemas</option>
        <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
      </UiSelect>
      <div class="search-field filter">
        <Icon name="search" />
        <input v-model="filter" class="input" type="search" placeholder="Filter" aria-label="Filter objects" />
      </div>
      <label class="check inline"><input v-model="onlyAllowed" type="checkbox" /><span>With access only</span></label>
      <span class="grow" />
      <div v-if="loading" class="spinner small" />
      <button class="btn icon-only" title="Debug" aria-label="Debug" @click="m.setTab('debug')"><Icon name="bug" /></button>
    </div>

    <SourceLegend class="legend-row" />

    <div v-if="principal?.attributes.superuser" class="notice warning section">
      <Icon name="shield" />
      <span>{{ principal.name }} is a superuser: every permission check is skipped.</span>
    </div>

    <div v-if="error" class="notice danger"><Icon name="fail" /><span class="mono">{{ error }}</span></div>
    <div v-else-if="result && !rows.length" class="box empty">
      <div class="lead">{{ filter || onlyAllowed ? "Nothing matches." : `No ${result.objectType.plural.toLowerCase()} here.` }}</div>
    </div>
    <div v-else-if="result" class="box grid">
      <table class="table fixed">
        <colgroup>
          <col />
          <col style="width: 130px" />
          <col v-for="p in privileges" :key="p.id" :style="{ width: columnWidth }" />
        </colgroup>
        <thead>
          <tr>
            <th>{{ result.objectType.label }}</th>
            <th>Owner</th>
            <th v-for="p in privileges" :key="p.id" class="center priv" :title="p.description">{{ p.id }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="JSON.stringify(row.object)">
            <td class="ellipsis" :title="objectLabel(row.object)">
              <span class="entity obj">
                <EntityIcon :type="row.object.type" :subtype="row.object.subtype" />{{ objectLabel(row.object)
                }}<span v-if="row.object.subtype && row.object.subtype !== row.object.type" class="sub">{{ row.object.subtype }}</span>
              </span>
            </td>
            <td class="ellipsis">{{ row.owner }}</td>
            <td v-for="p in privileges" :key="p.id" class="center cell">
              <SourceChip
                :cell="row.cells[p.id]"
                :label="`${p.id} on ${objectLabel(row.object)}`"
                clickable
                @click="explain(row, p.id)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="loading" class="spinner" />
    <p v-if="result" class="section-foot">
      {{ footer }} Click a chip to open Debug with the question filled in.
      <template v-if="result.truncated">Showing the first {{ result.rows.length }}; pick a schema to narrow it down.</template>
    </p>
  </div>
</template>

<style scoped>
.toolbar {
  flex-wrap: nowrap;
  min-width: 0;
}
.segmented {
  flex: none;
}
.filter {
  flex: 1;
  min-width: 120px;
  max-width: 200px;
}
.legend-row {
  margin-bottom: 12px;
}
.grid {
  overflow: auto;
}
.priv {
  padding: 7px 4px;
  font-size: 11px;
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell {
  padding: 0 8px;
}
.table td:first-child {
  color: var(--text-dark);
}
.entity .sub {
  margin-left: 0;
}
@media (max-width: 1100px) {
  .toolbar {
    flex-wrap: wrap;
  }
}
</style>
