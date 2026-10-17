<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { objectLabel } from "../../core/objects";
import type { EffectivePrivileges, ObjectPrivileges } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";
import PrivilegeDot from "../PrivilegeDot.vue";
import SourceLegend from "../SourceLegend.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const types = computed(() => (m.caps.value?.objectTypes ?? []).filter((t) => t.browse));
const type = ref(types.value[0]?.id ?? "");
const schemas = ref<string[]>([]);
const schema = ref<string>("");
const onlyAllowed = ref(false);
const filter = ref("");
const loading = ref(false);
const error = ref("");
const result = shallowRef<EffectivePrivileges>();
let request = 0;

const typeDef = computed(() => types.value.find((t) => t.id === type.value));

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

function explain(row: ObjectPrivileges, privilege: string) {
  if (principal.value) m.ask(principal.value.name, { object: row.object, privilege });
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
  <div class="effective">
    <div class="toolbar row wrap">
      <div class="segmented">
        <button v-for="t in types" :key="t.id" :class="{ active: type === t.id }" @click="type = t.id">{{ t.plural }}</button>
      </div>
      <select v-if="typeDef?.schemaScoped" v-model="schema" class="input" aria-label="Schema">
        <option value="">All schemas</option>
        <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
      </select>
      <input v-model="filter" class="input" type="search" placeholder="Filter" aria-label="Filter objects" />
      <label class="check"><input v-model="onlyAllowed" type="checkbox" /> <span>With access only</span></label>
      <div class="grow" />
      <div v-if="loading" class="spinner small" />
    </div>

    <div v-if="principal?.attributes.superuser" class="notice warning">
      <Icon name="shield" :size="14" />
      <span>{{ principal.name }} is a superuser: every permission check is skipped.</span>
    </div>

    <SourceLegend />

    <div v-if="error" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ error }}</span></div>
    <div v-else-if="result && !rows.length" class="empty-note">Nothing to show.</div>
    <div v-else-if="result" class="table-wrap matrix">
      <table class="table">
        <thead>
          <tr>
            <th>{{ typeDef?.label }}</th>
            <th v-if="type !== 'database' && type !== 'schema'">Owner</th>
            <th v-for="p in result.objectType.privileges" :key="p.id" class="center" :title="p.description">{{ p.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="JSON.stringify(row.object)">
            <td class="mono name">
              {{ objectLabel(row.object) }}
              <span v-if="row.object.subtype && row.object.subtype !== row.object.type" class="muted subtype">{{ row.object.subtype }}</span>
            </td>
            <td v-if="type !== 'database' && type !== 'schema'" class="muted">{{ row.owner }}</td>
            <td v-for="p in result.objectType.privileges" :key="p.id" class="center">
              <button class="cell" :aria-label="`Explain ${p.id} on ${objectLabel(row.object)}`" @click="explain(row, p.id)">
                <PrivilegeDot :cell="row.cells[p.id]" :label="p.id" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="result?.truncated" class="hint">Showing the first {{ result.rows.length }} objects. Pick a schema to narrow it down.</p>
    <p class="hint">Click a cell for the full explanation.</p>
  </div>
</template>

<style scoped>
.effective {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.toolbar {
  gap: 8px;
}
.toolbar .input[type="search"] {
  width: 160px;
}
.matrix {
  max-height: calc(100vh - 290px);
}
.name {
  white-space: nowrap;
}
.subtype {
  margin-left: 6px;
  font-family: var(--font-family);
  font-size: 0.6875rem;
}
.cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.cell:hover {
  background: var(--raised-hover);
}
</style>
