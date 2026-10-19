<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SettingEntry } from "../../engines/types";
import { useManager } from "../../state/inject";
import Combobox from "../Combobox.vue";
import Icon from "../Icon.vue";
import UiSelect from "../UiSelect.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const suggestions = computed(() => m.caps.value?.settingSuggestions ?? []);
const common = computed(() => suggestions.value.slice(0, 5));
const items = computed(() => suggestions.value.map((s) => ({ value: s, label: s })));

const name = ref("");
const value = ref("");
const database = ref("");
/** The row being edited, tinted until the form is sent or cancelled. */
const editing = ref<SettingEntry>();
const valueInput = ref<HTMLInputElement>();

const nameError = computed(() =>
  name.value && !/^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(name.value) ? "Not a valid parameter name" : ""
);
const placeholder = computed(() => (name.value === "search_path" ? '"$user", public' : name.value.endsWith("timeout") ? "30s" : ""));

function review() {
  if (!principal.value || !name.value || nameError.value) return;
  const { engine, server } = m.need();
  const changes = [{ action: "set" as const, name: name.value, value: value.value, database: database.value || undefined }];
  // Moving a setting to another scope resets the old one.
  const before = editing.value;
  const plan = engine.planSettings(
    principal.value,
    before && (before.name !== name.value || (before.database ?? "") !== database.value)
      ? [{ action: "reset", name: before.name, database: before.database }, ...changes]
      : changes,
    server
  );
  m.review(plan);
}

function reset(s: SettingEntry) {
  if (!principal.value) return;
  const { engine, server } = m.need();
  m.review(engine.planSettings(principal.value, [{ action: "reset", name: s.name, database: s.database }], server));
}

function edit(s: SettingEntry) {
  editing.value = s;
  name.value = s.name;
  value.value = s.value;
  database.value = s.database ?? "";
  valueInput.value?.focus();
}

function cancel() {
  editing.value = undefined;
  name.value = "";
  value.value = "";
  database.value = "";
}

function pick(param: string) {
  name.value = param;
  valueInput.value?.focus();
}

// An applied change leaves nothing to edit.
watch(() => state.revision, cancel);

const isEditing = (s: SettingEntry) => editing.value?.name === s.name && editing.value?.database === s.database;
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <span class="title">Session parameters</span>
        <span class="pill">{{ state.detail?.settings.length ?? "…" }}</span>
        <span class="hint">Applied when {{ principal?.name }} logs in. Role settings override database and server defaults.</span>
      </div>
      <div v-if="state.detail && !state.detail.settings.length" class="box note">
        None. Sessions use the database and server defaults.
      </div>
      <div v-else-if="state.detail" class="box">
        <table class="table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Value</th>
              <th style="width: 30%">Applies in</th>
              <th style="width: 110px" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in state.detail.settings" :key="`${s.database}:${s.name}`" :class="{ pending: isEditing(s) }">
              <td class="mono strong">{{ s.name }}</td>
              <td class="mono value">{{ s.value }}</td>
              <td>
                <span class="scope">
                  <Icon v-if="s.database" name="database" :size="14" color="var(--entity-database)" />
                  <Icon v-else name="dns" :size="14" color="var(--text-lighter)" />
                  {{ s.database ?? "All databases" }}
                </span>
              </td>
              <td class="actions">
                <button class="btn quiet small icon-only" :class="{ editing: isEditing(s) }" title="Edit" @click="edit(s)">
                  <Icon name="edit" />
                </button>
                <button class="btn small" :disabled="m.readOnly.value" @click="reset(s)">Reset</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <form class="panel" @submit.prevent="review">
      <div class="panel-head">
        <span class="title">{{ editing ? `Edit ${editing.name}` : "Set a parameter" }}</span>
        <span class="hint">
          {{ editing ? "Filled from the row above · Cancel leaves it unchanged" : "Suggestions appear as you type · Review shows the ALTER ROLE statement" }}
        </span>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="setting-name">Parameter</label>
          <Combobox id="setting-name" :model-value="name" :items="items" mono free-text placeholder="Parameter" @update:model-value="pick" />
        </div>
        <div class="field">
          <label for="setting-value">Value</label>
          <input id="setting-value" ref="valueInput" v-model="value" class="input mono" :placeholder="placeholder || 'Value'" />
        </div>
        <div class="field">
          <label for="setting-db">Applies in</label>
          <UiSelect id="setting-db" v-model="database">
            <option value="">All databases</option>
            <option :value="state.server?.database">{{ state.server?.database }}</option>
          </UiSelect>
        </div>
        <div class="buttons">
          <button v-if="editing" class="btn ghost" type="button" @click="cancel">Cancel</button>
          <button class="btn primary" type="submit" :disabled="!name || !!nameError || m.readOnly.value">Review</button>
        </div>
      </div>
      <div v-if="nameError" class="field-error">{{ nameError }}</div>
      <div v-if="common.length" class="common">
        Common:
        <template v-for="(c, i) in common" :key="c">
          <button type="button" class="link quiet" @click="pick(c)">{{ c }}</button><span v-if="i < common.length - 1"> · </span>
        </template>
      </div>
    </form>
  </div>
</template>

<style scoped>
.section-head .hint {
  font-size: 12.5px;
}
.value {
  color: var(--setting-value, var(--accent));
}
.scope {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.btn.editing {
  color: var(--accent);
}
.panel {
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--raised);
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.panel-head .title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-dark);
}
.panel-head .hint {
  font-size: 12.5px;
  color: var(--text-light);
}
.form-grid {
  display: grid;
  grid-template-columns: 260px 1fr 200px auto;
  gap: 12px;
  align-items: end;
}
.form-grid .field > label {
  padding-left: 6px;
}
.form-grid :deep(.combo),
.form-grid :deep(.ui-select) {
  width: 100%;
}
.buttons {
  display: flex;
  gap: 6px;
}
.common {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-lighter);
}
.common .link {
  font-size: 12px;
}
.field-error {
  margin-top: 6px;
}
@media (max-width: 1000px) {
  .form-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
