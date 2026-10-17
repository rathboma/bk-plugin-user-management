<script setup lang="ts">
import { computed, ref } from "vue";
import type { SettingEntry } from "../../engines/types";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const SUGGESTIONS = [
  "search_path",
  "statement_timeout",
  "idle_in_transaction_session_timeout",
  "lock_timeout",
  "work_mem",
  "default_transaction_read_only",
  "default_transaction_isolation",
  "role",
  "timezone",
  "log_statement",
  "log_min_duration_statement",
  "application_name",
];

const name = ref("");
const value = ref("");
const database = ref("");
const nameError = computed(() =>
  name.value && !/^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(name.value) ? "Not a valid parameter name" : ""
);

function add() {
  if (!principal.value || !name.value || nameError.value) return;
  const { engine, server } = m.need();
  m.review(
    engine.planSettings(principal.value, [{ action: "set", name: name.value, value: value.value, database: database.value || undefined }], server)
  );
}

function reset(s: SettingEntry) {
  if (!principal.value) return;
  const { engine, server } = m.need();
  m.review(engine.planSettings(principal.value, [{ action: "reset", name: s.name, database: s.database }], server));
}

function edit(s: SettingEntry) {
  name.value = s.name;
  value.value = s.value;
  database.value = s.database ?? "";
}
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <h3>Settings <span class="count">{{ state.detail?.settings.length ?? "…" }}</span></h3>
        <span class="hint">Applied when {{ principal?.name }} starts a session (ALTER ROLE … SET)</span>
      </div>
      <div v-if="state.detail && !state.detail.settings.length" class="empty-note">No settings. Sessions use the server defaults.</div>
      <div v-else-if="state.detail" class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Parameter</th><th>Value</th><th>Database</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="s in state.detail.settings" :key="`${s.database}:${s.name}`">
              <td class="mono">{{ s.name }}</td>
              <td class="mono">{{ s.value }}</td>
              <td :class="{ muted: !s.database }">{{ s.database ?? "All databases" }}</td>
              <td class="actions">
                <button class="btn ghost icon-only" title="Edit" @click="edit(s)"><Icon name="edit" :size="14" /></button>
                <button class="btn ghost" @click="reset(s)">Reset</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section card add">
      <h3 class="add-title">Set a parameter</h3>
      <form class="row wrap" @submit.prevent="add">
        <div class="field">
          <label for="setting-name">Parameter</label>
          <input id="setting-name" v-model="name" class="input mono" list="setting-names" placeholder="statement_timeout" :class="{ invalid: nameError }" />
          <datalist id="setting-names">
            <option v-for="s in SUGGESTIONS" :key="s" :value="s" />
          </datalist>
        </div>
        <div class="field grow">
          <label for="setting-value">Value</label>
          <input id="setting-value" v-model="value" class="input mono" :placeholder="name === 'search_path' ? '&quot;$user&quot;, public' : '30s'" />
        </div>
        <div class="field">
          <label for="setting-db">Applies in</label>
          <select id="setting-db" v-model="database" class="input">
            <option value="">All databases</option>
            <option :value="state.server?.database">{{ state.server?.database }} only</option>
          </select>
        </div>
        <button class="btn primary" type="submit" :disabled="!name || !!nameError">Review</button>
      </form>
      <div v-if="nameError" class="field-error">{{ nameError }}</div>
      <p class="hint">Lists such as search_path are split on commas. Changes apply to new sessions only.</p>
    </section>
  </div>
</template>

<style scoped>
.add form {
  align-items: flex-end;
}
.add-title {
  margin: 0 0 10px;
  font-size: 0.8125rem;
}
.add .hint {
  margin: 8px 0 0;
}
</style>
