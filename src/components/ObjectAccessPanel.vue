<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { objectLabel } from "../core/objects";
import type { ObjectAccess, ObjectRef } from "../engines/types";
import { errorMessage } from "../host/host";
import { useManager } from "../state/inject";
import CheckList from "./CheckList.vue";
import EntityIcon from "./EntityIcon.vue";
import Icon from "./Icon.vue";
import ObjectPicker from "./ObjectPicker.vue";
import PrincipalLink from "./PrincipalLink.vue";
import SourceChip from "./SourceChip.vue";
import SourceLegend from "./SourceLegend.vue";
import UiSelect from "./UiSelect.vue";

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
const privileges = computed(() => result.value?.objectType.privileges ?? []);
/** Narrow columns when there are many privileges, wide enough for the longest name. */
const columnWidth = computed(() => {
  const longest = Math.max(0, ...privileges.value.map((p) => p.id.length));
  return `${Math.max(privileges.value.length > 4 ? 78 : 120, Math.ceil(longest * 7.6 + 10))}px`;
});

const rows = computed(() => {
  const term = filter.value.trim().toLowerCase();
  return (result.value?.rows ?? []).filter(
    (r) =>
      (state.showSystem || !systemNames.value.has(r.principal)) &&
      (!term || r.principal.toLowerCase().includes(term)) &&
      (!onlyAllowed.value || Object.values(r.cells).some((c) => c.allowed || c.sources.length))
  );
});
const hidden = computed(() => (result.value?.rows.length ?? 0) - rows.value.length);

function setType(value: string) {
  type.value = value;
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
    <div class="question">
      <span>Who can access</span>
      <UiSelect :model-value="type" label="Object type" @update:model-value="setType">
        <option v-for="t in types" :key="t.id" :value="t.id">{{ t.label.toLowerCase() }}</option>
      </UiSelect>
      <ObjectPicker :key="type" v-model="object" :type="type" min-width="320px" />
      <span>?</span>
      <span class="grow" />
      <div v-if="loading" class="spinner small" />
      <button class="btn" type="button" :disabled="!object || m.readOnly.value" @click="grant"><Icon name="add" />Grant</button>
    </div>

    <div v-if="!object" class="box empty">
      <div class="lead">Pick an object to see every role's privileges on it.</div>
      <div class="sub">
        Each chip says where a privilege comes from. In Beekeeper Studio's sidebar, right-click a table or schema and choose
        Who Can Access This? to open it here.
      </div>
    </div>

    <div v-if="error" class="notice danger section"><Icon name="fail" /><span class="mono">{{ error }}</span></div>

    <template v-if="result && object">
      <div class="section-head">
        <span class="entity obj title-entity">
          <EntityIcon :type="result.object.type" :subtype="result.object.subtype" :size="18" />{{ objectLabel(result.object) }}
        </span>
        <span class="tag">{{ result.object.subtype && result.object.subtype !== "system" ? result.object.subtype : result.objectType.label.toLowerCase() }}</span>
        <span v-if="result.owner" class="owner">owned by <PrincipalLink :name="result.owner" /></span>
        <span class="grow" />
        <div class="search-field filter">
          <Icon name="search" />
          <input v-model="filter" class="input" type="search" placeholder="Filter roles" aria-label="Filter roles" />
        </div>
        <label class="check inline"><input v-model="onlyAllowed" type="checkbox" /><span>With access only</span></label>
      </div>

      <div v-if="result.notes.length" class="section"><CheckList :checks="result.notes" /></div>
      <SourceLegend class="legend-row" />

      <div v-if="!rows.length" class="box empty">
        <div class="lead">{{ filter ? "No roles match." : "No role has any privilege on it." }}</div>
        <div v-if="!filter && result.owner" class="sub">Only {{ result.owner }}, the owner, and superusers can use it.</div>
      </div>
      <div v-else class="box grid">
        <table class="table fixed">
          <colgroup>
            <col />
            <col v-for="p in privileges" :key="p.id" :style="{ width: columnWidth }" />
          </colgroup>
          <thead>
            <tr>
              <th>User or role</th>
              <th v-for="p in privileges" :key="p.id" class="center priv" :title="p.description">{{ p.id }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.principal">
              <td class="ellipsis"><PrincipalLink :name="row.principal" /></td>
              <td v-for="p in privileges" :key="p.id" class="center cell">
                <SourceChip
                  :cell="row.cells[p.id]"
                  :label="`${row.principal}: ${p.id}`"
                  clickable
                  @click="m.ask(row.principal, { object: result!.object, privilege: p.id })"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="section-foot">
        {{ rows.length === 1 ? "1 role" : `${rows.length} roles` }}<template v-if="hidden"> · {{ hidden }} hidden by the filters</template>.
        Click a chip to open that role's Debug tab with the question filled in.
      </p>
    </template>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 20px;
}
.question {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 18px;
  font-size: 14px;
  color: var(--text);
}
.title-entity {
  font-size: 13.5px;
  font-weight: 500;
}
.owner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-light);
  white-space: nowrap;
}
.filter {
  width: 180px;
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
</style>
