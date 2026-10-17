<script setup lang="ts">
import { computed, ref } from "vue";
import type { ChangePlan } from "../../engines/types";
import { host } from "../../host/host";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";
import Modal from "../Modal.vue";

const m = useManager();
const duplicate = m.state.dialog?.type === "duplicate";
const principal = m.selectedPrincipal.value!;
const name = ref(duplicate ? `${principal.name}_copy` : principal.name);

const nameError = computed(() => {
  if (!duplicate) return "";
  const { engine, server } = m.need();
  const invalid = engine.validateName(name.value, server);
  if (invalid) return invalid;
  return m.state.principals.some((p) => p.name === name.value) ? `${name.value} already exists.` : "";
});

const sql = computed(() => {
  const detail = m.state.detail;
  if (!detail) return "";
  const { engine, server } = m.need();
  return engine.script(detail, m.state.memberships, server, duplicate ? { name: name.value } : {});
});

/** The whole script as one reviewed change. */
function review() {
  if (nameError.value) return;
  const body = sql.value.trim().replace(/;$/, "");
  const plan: ChangePlan = {
    title: `Create ${name.value} like ${principal.name}`,
    statements: [{ sql: body }],
    warnings: principal.attributes.login ? ["The password is not copied. Set one after creating it."] : [],
    selectAfter: name.value,
  };
  m.review(plan);
}
</script>

<template>
  <Modal :title="duplicate ? `Duplicate ${principal.name}` : `SQL for ${principal.name}`" wide @close="m.closeDialog()">
    <div v-if="duplicate" class="field">
      <label for="dup-name">New name</label>
      <input id="dup-name" v-model="name" class="input mono" :class="{ invalid: nameError }" spellcheck="false" />
      <div v-if="nameError" class="field-error">{{ nameError }}</div>
      <div v-else class="hint">Copies attributes, settings, memberships, privileges and default privileges in {{ m.state.server?.database }}.</div>
    </div>
    <pre class="code script">{{ sql }}</pre>
    <template #footer>
      <button class="btn ghost" @click="host.copy(sql)"><Icon name="copy" :size="14" /> Copy</button>
      <button class="btn ghost" @click="host.openQueryTab(sql)"><Icon name="external" :size="14" /> Open in query tab</button>
      <button v-if="!duplicate" class="btn ghost" @click="host.saveFile(sql, `${principal.name}.sql`)">
        <Icon name="download" :size="14" /> Save
      </button>
      <div class="grow" />
      <button class="btn" @click="m.closeDialog()">{{ duplicate ? "Cancel" : "Close" }}</button>
      <button v-if="duplicate" class="btn primary" :disabled="!!nameError" @click="review">Review</button>
    </template>
  </Modal>
</template>

<style scoped>
.script {
  max-height: 420px;
}
</style>
