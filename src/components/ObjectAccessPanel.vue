<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { objectLabel } from "../core/objects";
import type { ObjectAccess, ObjectRef } from "../engines/types";
import { errorMessage } from "../host/host";
import { useManager } from "../state/inject";
import CheckList from "./CheckList.vue";
import Icon from "./Icon.vue";
import ObjectPicker from "./ObjectPicker.vue";
import PrivilegeDot from "./PrivilegeDot.vue";
import SourceLegend from "./SourceLegend.vue";

const m = useManager();
const { state } = m;

const types = computed(() => (m.caps.value?.objectTypes ?? []).filter((t) => t.browse || t.id === "type"));
const type = ref(state.object?.type ?? "table");
const object = ref<ObjectRef | undefined>(state.object);
const onlyAllowed = ref(true);
const filter = ref("");
const loading = ref(false);
const error = ref("");
const result = shallowRef<ObjectAccess>();
let request = 0;

async function load() {
  if (!object.value) {
    result.value = undefined;
    return;
  }
  const { engine, server } = m.need();
  const current = ++request;
  loading.value = true;
  error.value = "";
  try {
    const data = await engine.objectAccess(m.run, server, m.ctx.value, object.value);
    if (current === request) result.value = data;
  } catch (e) {
    if (current === request) {
      result.value = undefined;
      error.value = errorMessage(e);
    }
  } finally {
    if (current === request) loading.value = false;
  }
}

const systemNames = computed(() => new Set(state.principals.filter((p) => p.system).map((p) => p.name)));
const kinds = computed(() => new Map(state.principals.map((p) => [p.name, p.kind])));

const rows = computed(() => {
  const term = filter.value.trim().toLowerCase();
  return (result.value?.rows ?? []).filter(
    (r) =>
      (state.showSystem || !systemNames.value.has(r.principal)) &&
      (!term || r.principal.toLowerCase().includes(term)) &&
      (!onlyAllowed.value || Object.values(r.cells).some((c) => c.allowed || c.sources.length))
  );
});

function onTypeChange() {
  object.value = undefined;
  result.value = undefined;
}

function grant() {
  if (object.value) m.openDialog({ type: "grant", object: object.value });
}

onMounted(load);
watch(object, (value) => {
  if (value) m.showObject(value);
  void load();
});
watch(() => state.revision, load);
</script>

<template>
  <div class="panel">
    <form class="card picker-row" @submit.prevent="load">
      <div class="field">
        <label for="oa-type">Who can access</label>
        <select id="oa-type" v-model="type" class="input" @change="onTypeChange">
          <option v-for="t in types" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </div>
      <div class="field grow">
        <label for="oa-object">{{ types.find((t) => t.id === type)?.label }}</label>
        <ObjectPicker id="oa-object" :key="type" v-model="object" :type="type" />
      </div>
      <button class="btn" type="button" :disabled="!object" @click="grant"><Icon name="plus" :size="14" /> Grant</button>
    </form>

    <div v-if="!object" class="empty-note">
      Pick an object to see every role's privileges on it, and where each one comes from. Right-click a table or schema in
      Beekeeper Studio's sidebar and choose <strong>Who Can Access This?</strong> to open it here.
    </div>

    <div v-if="error" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ error }}</span></div>

    <template v-if="result">
      <div class="row wrap summary">
        <h2 class="mono">{{ objectLabel(result.object) }}</h2>
        <span class="badge">{{ result.object.subtype ?? result.objectType.label }}</span>
        <span v-if="result.owner" class="muted">owned by <button class="link" @click="m.select(result.owner!)">{{ result.owner }}</button></span>
        <div class="grow" />
        <div v-if="loading" class="spinner small" />
        <input v-model="filter" class="input" type="search" placeholder="Filter roles" aria-label="Filter roles" />
        <label class="check"><input v-model="onlyAllowed" type="checkbox" /> <span>With access only</span></label>
      </div>
      <CheckList v-if="result.notes.length" :checks="result.notes" />
      <SourceLegend />
      <div v-if="!rows.length" class="empty-note">No roles match.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Role</th>
              <th v-for="p in result.objectType.privileges" :key="p.id" class="center" :title="p.description">{{ p.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.principal">
              <td>
                <span class="row who">
                  <Icon :name="kinds.get(row.principal) === 'user' ? 'user' : 'role'" :size="13" class="muted" />
                  <button class="link" @click="m.select(row.principal)">{{ row.principal }}</button>
                </span>
              </td>
              <td v-for="p in result.objectType.privileges" :key="p.id" class="center">
                <button
                  class="cell"
                  :aria-label="`Explain ${p.id} for ${row.principal}`"
                  @click="m.ask(row.principal, { object: result!.object, privilege: p.id })"
                >
                  <PrivilegeDot :cell="row.cells[p.id]" :label="`${row.principal} ${p.id}`" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">Click a cell for the full explanation in the role's Debug tab.</p>
    </template>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.picker-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.picker-row .grow {
  min-width: 280px;
}
.summary h2 {
  margin: 0;
  font-size: 1rem;
}
.summary .input {
  width: 160px;
}
.who {
  gap: 6px;
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
