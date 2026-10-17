<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import type { GrantChange, GrantTarget, ObjectRef } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import FilterList from "../FilterList.vue";
import Icon from "../Icon.vue";
import Modal from "../Modal.vue";
import ObjectPicker from "../ObjectPicker.vue";

type Mode = "object" | "all-in-schema" | "default";

const m = useManager();
const caps = m.caps.value!;
const dialog = m.state.dialog as { type: "grant"; grantee?: string; object?: ObjectRef; target?: Mode };

const form = reactive({
  action: "grant" as "grant" | "revoke",
  grantee: dialog.grantee ?? "",
  mode: (dialog.target ?? "object") as Mode,
  type: dialog.object?.type ?? "table",
  object: dialog.object as ObjectRef | undefined,
  schema: dialog.object?.schema ?? "",
  owner: m.state.server?.currentUser ?? "",
  columns: [] as string[],
  privileges: [] as string[],
  withGrantOption: false,
  alsoFuture: false,
  cascade: false,
});
const schemas = ref<string[]>([]);
const columns = ref<string[]>([]);
const error = ref("");

const types = computed(() =>
  caps.objectTypes.filter((t) => (form.mode === "all-in-schema" ? t.allInSchema : form.mode === "default" ? t.defaults : true))
);
const typeDef = computed(() => caps.objectTypes.find((t) => t.id === form.type));
const privileges = computed(() => {
  const list = typeDef.value?.privileges ?? [];
  if (form.mode === "object" && form.columns.length && typeDef.value?.columnPrivileges) {
    return list.filter((p) => typeDef.value!.columnPrivileges!.includes(p.id));
  }
  return list;
});
const grantees = computed(() => [
  ...(caps.publicGrantee ? [{ value: caps.publicGrantee.id, label: caps.publicGrantee.label }] : []),
  ...m.state.principals.filter((p) => !p.system || form.grantee === p.name).map((p) => ({ value: p.name, label: p.name })),
]);
const needsSchema = computed(() => form.mode === "all-in-schema" || (form.mode === "default" && typeDef.value?.schemaScoped));

const valid = computed(
  () =>
    form.grantee &&
    form.privileges.length &&
    (form.mode !== "object" || form.object) &&
    (form.mode !== "all-in-schema" || form.schema) &&
    (form.mode !== "default" || form.owner)
);

function setMode(mode: Mode) {
  form.mode = mode;
  if (!types.value.some((t) => t.id === form.type)) form.type = types.value[0]?.id ?? "table";
  if (mode === "all-in-schema" && !form.schema) form.schema = schemas.value[0] ?? "";
}

async function loadColumns() {
  columns.value = [];
  form.columns = [];
  if (form.mode !== "object" || !form.object || !typeDef.value?.columnPrivileges) return;
  const { engine, server } = m.need();
  columns.value = await engine.listColumns(m.run, server, form.object).catch(() => []);
}

watch(() => form.type, () => {
  form.object = undefined;
  form.privileges = [];
});
watch(() => form.object, loadColumns);
watch(privileges, (list) => {
  form.privileges = form.privileges.filter((p) => list.some((x) => x.id === p));
});

onMounted(async () => {
  const { engine, server } = m.need();
  schemas.value = await engine.listSchemas(m.run, server).catch(() => []);
  if (needsSchema.value && !form.schema) form.schema = schemas.value[0] ?? "";
  await loadColumns();
});

function allPrivileges(on: boolean) {
  form.privileges = on ? privileges.value.map((p) => p.id) : [];
}

function submit() {
  if (!valid.value) return;
  const targets: GrantTarget[] = [];
  if (form.mode === "object") targets.push({ kind: "object", object: form.object!, columns: form.columns.length ? form.columns : undefined });
  if (form.mode === "all-in-schema") {
    targets.push({ kind: "all-in-schema", objectType: form.type, schema: form.schema });
    if (form.alsoFuture && typeDef.value?.defaults)
      targets.push({ kind: "default", objectType: form.type, schema: form.schema, owner: form.owner });
  }
  if (form.mode === "default") {
    targets.push({ kind: "default", objectType: form.type, schema: typeDef.value?.schemaScoped ? form.schema || undefined : undefined, owner: form.owner });
  }
  const changes: GrantChange[] = targets.map((target) => ({
    action: form.action,
    target,
    privileges: form.privileges,
    grantee: form.grantee,
    withGrantOption: form.action === "grant" && form.withGrantOption,
    cascade: form.action === "revoke" && form.cascade,
  }));
  try {
    const { engine, server } = m.need();
    m.review(engine.planGrants(changes, server));
  } catch (e) {
    error.value = errorMessage(e);
  }
}
</script>

<template>
  <Modal :title="form.action === 'grant' ? 'Grant privileges' : 'Revoke privileges'" wide @close="m.closeDialog()">
    <div class="row wrap">
      <div class="segmented">
        <button :class="{ active: form.action === 'grant' }" @click="form.action = 'grant'">Grant</button>
        <button :class="{ active: form.action === 'revoke' }" @click="form.action = 'revoke'">Revoke</button>
      </div>
      <div class="segmented">
        <button :class="{ active: form.mode === 'object' }" @click="setMode('object')">One object</button>
        <button :class="{ active: form.mode === 'all-in-schema' }" @click="setMode('all-in-schema')">Everything in a schema</button>
        <button :class="{ active: form.mode === 'default' }" @click="setMode('default')">Objects created later</button>
      </div>
    </div>

    <div class="grid">
      <div class="field">
        <label for="g-grantee">{{ form.action === "grant" ? "To" : "From" }}</label>
        <select id="g-grantee" v-model="form.grantee" class="input">
          <option value="" disabled>Choose a user or role</option>
          <option v-for="g in grantees" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
      </div>
      <div class="field">
        <label for="g-type">{{ form.mode === "object" ? "Type" : "Object type" }}</label>
        <select id="g-type" v-model="form.type" class="input">
          <option v-for="t in types" :key="t.id" :value="t.id">{{ form.mode === "object" ? t.label : t.plural }}</option>
        </select>
      </div>
    </div>

    <div v-if="form.mode === 'object'" class="field">
      <label for="g-object">{{ typeDef?.label }}</label>
      <ObjectPicker id="g-object" :key="form.type" v-model="form.object" :type="form.type" />
    </div>

    <div v-if="form.mode === 'default'" class="field">
      <label for="g-owner">Objects created by</label>
      <select id="g-owner" v-model="form.owner" class="input">
        <option v-for="p in m.state.principals.filter((p) => !p.system)" :key="p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <div class="hint">Default privileges only apply to objects this role creates.</div>
    </div>

    <div v-if="needsSchema" class="field">
      <label for="g-schema">Schema</label>
      <select id="g-schema" v-model="form.schema" class="input">
        <option v-if="form.mode === 'default'" value="">Any schema</option>
        <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <div v-if="columns.length" class="field">
      <span class="field-label">Columns <span class="hint">(optional: leave empty for the whole table)</span></span>
      <FilterList v-model="form.columns" :items="columns.map((c) => ({ value: c, label: c }))" placeholder="Filter columns" />
    </div>

    <div class="field">
      <div class="row">
        <span class="field-label grow">Privileges</span>
        <button class="btn ghost" type="button" @click="allPrivileges(form.privileges.length < privileges.length)">
          {{ form.privileges.length < privileges.length ? "Select all" : "Clear" }}
        </button>
      </div>
      <div class="privs">
        <label v-for="p in privileges" :key="p.id" class="check priv">
          <input v-model="form.privileges" type="checkbox" :value="p.id" />
          <span>
            <span class="check-label mono">{{ p.id }}</span>
            <span v-if="p.description" class="hint">{{ p.description }}</span>
          </span>
        </label>
      </div>
    </div>

    <div class="options">
      <label v-if="form.action === 'grant'" class="check">
        <input v-model="form.withGrantOption" type="checkbox" />
        <span class="check-label">With grant option</span>
        <span class="hint">can grant it on to others</span>
      </label>
      <label v-if="form.action === 'revoke'" class="check">
        <input v-model="form.cascade" type="checkbox" />
        <span class="check-label">Cascade</span>
        <span class="hint">also revoke what it granted on to others</span>
      </label>
      <label v-if="form.mode === 'all-in-schema' && typeDef?.defaults" class="check">
        <input v-model="form.alsoFuture" type="checkbox" />
        <span class="check-label">Also for objects created later</span>
        <span class="hint">by {{ form.owner }}</span>
      </label>
    </div>

    <div v-if="error" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ error }}</span></div>
    <template #footer>
      <button class="btn" @click="m.closeDialog()">Cancel</button>
      <button class="btn primary" :disabled="!valid" @click="submit">Review</button>
    </template>
  </Modal>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.privs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px 14px;
}
.priv > span {
  display: flex;
  flex-direction: column;
}
.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.options .check {
  align-items: center;
}
.options .check input {
  margin: 0;
}
</style>
