<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { objectLabel, sameObject } from "../core/objects";
import type { ObjectRef } from "../engines/types";
import { useManager } from "../state/inject";

/**
 * Picks one object of a type: a schema list (when the type has schemas) and a
 * searchable name. Give it a :key of the type so it starts over when the type changes.
 */
const props = defineProps<{ type: string; modelValue: ObjectRef | undefined; id?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: ObjectRef | undefined] }>();

const m = useManager();
const typeDef = computed(() => m.caps.value?.objectTypes.find((t) => t.id === props.type));
const schemas = ref<string[]>([]);
const schema = ref("");
const objects = ref<ObjectRef[]>([]);
const text = ref("");
const loading = ref(false);
const listId = `objects-${Math.random().toString(36).slice(2)}`;

// Names are qualified unless one schema is picked.
const label = (o: ObjectRef) => (typeDef.value?.schemaScoped && schema.value ? objectLabel({ ...o, schema: undefined }) : objectLabel(o));

async function loadObjects() {
  const { engine, server } = m.need();
  loading.value = true;
  try {
    objects.value = await engine.listObjects(
      m.run,
      server,
      props.type,
      typeDef.value?.schemaScoped ? schema.value || undefined : undefined
    );
  } catch {
    objects.value = [];
  } finally {
    loading.value = false;
  }
  const current = props.modelValue && objects.value.find((o) => sameObject(o, props.modelValue));
  text.value = current ? label(current) : "";
  if (!current && props.modelValue) emit("update:modelValue", undefined);
}

function onInput() {
  const match = objects.value.find((o) => label(o) === text.value) ?? objects.value.find((o) => o.name === text.value);
  emit("update:modelValue", match);
}

onMounted(async () => {
  if (typeDef.value?.schemaScoped) {
    const { engine, server } = m.need();
    schemas.value = await engine.listSchemas(m.run, server).catch(() => []);
  }
  await loadObjects();
  watch(schema, loadObjects);
  // Set from outside, e.g. a question from another tab.
  watch(
    () => props.modelValue,
    (value) => {
      if (!value || sameObject(value, objects.value.find((o) => label(o) === text.value))) return;
      if (schema.value && value.schema !== schema.value) schema.value = "";
      else text.value = label(value);
    }
  );
});
</script>

<template>
  <div class="picker">
    <select v-if="typeDef?.schemaScoped" v-model="schema" class="input" aria-label="Schema">
      <option value="">All schemas</option>
      <option v-for="s in schemas" :key="s" :value="s">{{ s }}</option>
    </select>
    <input
      :id="id"
      v-model="text"
      class="input grow"
      :class="{ invalid: text && !modelValue }"
      :list="listId"
      :placeholder="loading ? 'Loading…' : `${objects.length} ${typeDef?.plural.toLowerCase() ?? 'objects'}`"
      autocomplete="off"
      @input="onInput"
      @change="onInput"
    />
    <datalist :id="listId">
      <option v-for="o in objects" :key="JSON.stringify(o)" :value="label(o)" />
    </datalist>
  </div>
</template>

<style scoped>
.picker {
  display: flex;
  gap: 6px;
  min-width: 0;
}
.picker select {
  max-width: 40%;
}
</style>
