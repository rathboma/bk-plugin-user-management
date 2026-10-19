<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { objectKey, objectLabel } from "../core/objects";
import type { ObjectRef } from "../engines/types";
import { useManager } from "../state/inject";
import Combobox from "./Combobox.vue";
import EntityIcon from "./EntityIcon.vue";

/**
 * Picks one object of a type, by its qualified name. Give it a :key of the
 * type so it starts over when the type changes.
 */
const props = defineProps<{ type: string; modelValue: ObjectRef | undefined; id?: string; minWidth?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: ObjectRef | undefined] }>();

const m = useManager();
const typeDef = computed(() => m.caps.value?.objectTypes.find((t) => t.id === props.type));
const objects = ref<ObjectRef[]>([]);
const loading = ref(true);

const items = computed(() =>
  objects.value.map((o) => ({
    value: objectKey(o),
    label: objectLabel(o),
    hint: o.subtype && o.subtype !== o.type && o.subtype !== "table" && o.subtype !== "schema" ? o.subtype : undefined,
    object: o,
  }))
);
const value = computed(() => (props.modelValue ? objectKey(props.modelValue) : undefined));

function pick(key: string) {
  emit("update:modelValue", objects.value.find((o) => objectKey(o) === key));
}

onMounted(async () => {
  const { engine, server } = m.need();
  try {
    objects.value = await engine.listObjects(m.run, server, props.type);
  } catch {
    objects.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <Combobox
    :id="id"
    :items="items"
    :model-value="value"
    :loading="loading"
    :placeholder="`Choose a ${typeDef?.label.toLowerCase() ?? 'object'}`"
    :label="typeDef?.label"
    :min-width="minWidth"
    mono
    @update:model-value="pick"
  >
    <template #icon="{ item }">
      <EntityIcon :type="item.object.type" :subtype="item.object.subtype" />
    </template>
  </Combobox>
</template>
