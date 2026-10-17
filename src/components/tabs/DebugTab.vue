<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { describeSource } from "../../core/sources";
import type { AccessCheckResult, ChangePlan, Check, ObjectRef } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import CheckList from "../CheckList.vue";
import Icon from "../Icon.vue";
import ObjectPicker from "../ObjectPicker.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const types = computed(() => m.caps.value?.objectTypes ?? []);
const type = ref("table");
const object = ref<ObjectRef>();
const privilege = ref("SELECT");
const typeDef = computed(() => types.value.find((t) => t.id === type.value));

const checking = ref(false);
const checkError = ref("");
const result = shallowRef<AccessCheckResult>();

const loginChecks = shallowRef<Check[]>();
const loginLoading = ref(false);
const loginError = ref("");

function onTypeChange() {
  object.value = undefined;
  result.value = undefined;
  if (!typeDef.value?.privileges.some((p) => p.id === privilege.value)) privilege.value = typeDef.value?.privileges[0]?.id ?? "";
}

async function check() {
  if (!principal.value || !object.value) return;
  const { engine, server } = m.need();
  checking.value = true;
  checkError.value = "";
  try {
    result.value = await engine.checkAccess(m.run, server, m.ctx.value, {
      principal: principal.value.name,
      object: object.value,
      privilege: privilege.value,
    });
  } catch (e) {
    result.value = undefined;
    checkError.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
}

async function diagnose() {
  if (!principal.value) return;
  const { engine, server } = m.need();
  loginLoading.value = true;
  loginError.value = "";
  try {
    loginChecks.value = await engine.diagnoseLogin(m.run, server, m.ctx.value, principal.value);
  } catch (e) {
    loginChecks.value = undefined;
    loginError.value = errorMessage(e);
  } finally {
    loginLoading.value = false;
  }
}

function fix(plan: ChangePlan) {
  m.review(plan);
}

function applyQuestion() {
  const q = state.question;
  if (!q) return;
  type.value = q.object.type;
  object.value = q.object;
  privilege.value = q.privilege;
  state.question = undefined;
  void check();
}

onMounted(() => {
  applyQuestion();
  if (principal.value?.attributes.login && m.caps.value?.loginCheck) void diagnose();
});
watch(() => state.question, applyQuestion);
watch(
  () => state.revision,
  () => {
    if (result.value) void check();
    if (loginChecks.value) void diagnose();
  }
);
</script>

<template>
  <div class="debug">
    <section class="section">
      <div class="section-head">
        <h3>Can {{ principal?.name }} …</h3>
        <span class="hint">Checks a privilege and everything else access depends on</span>
      </div>
      <form class="card question" @submit.prevent="check">
        <div class="field priv">
          <label for="q-priv">Privilege</label>
          <select id="q-priv" v-model="privilege" class="input">
            <option v-for="p in typeDef?.privileges ?? []" :key="p.id" :value="p.id" :title="p.description">{{ p.id }}</option>
          </select>
        </div>
        <div class="field">
          <label for="q-type">on</label>
          <select id="q-type" v-model="type" class="input" @change="onTypeChange">
            <option v-for="t in types" :key="t.id" :value="t.id">{{ t.label }}</option>
          </select>
        </div>
        <div class="field grow">
          <label for="q-object">{{ typeDef?.label ?? "Object" }}</label>
          <ObjectPicker id="q-object" :key="type" v-model="object" :type="type" />
        </div>
        <button class="btn primary" type="submit" :disabled="!object || checking">
          <span v-if="checking" class="spinner small" />
          <Icon v-else name="play" :size="12" /> Check
        </button>
      </form>

      <div v-if="checkError" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ checkError }}</span></div>
      <div v-if="result" class="result">
        <div class="verdict" :class="result.allowed ? 'allowed' : 'denied'">
          <Icon :name="result.allowed ? 'ok' : 'fail'" :size="22" />
          <div class="grow">
            <div class="verdict-title">{{ result.allowed ? "Yes" : "No" }}</div>
            <div>{{ result.summary }}</div>
          </div>
          <button
            v-for="f in result.fixes"
            :key="f.title"
            class="btn primary"
            :disabled="m.readOnly.value"
            @click="fix(f)"
          >
            <Icon name="edit" :size="13" /> {{ f.title }}
          </button>
        </div>
        <ul v-if="result.cell.sources.length" class="sources">
          <li v-for="(s, i) in result.cell.sources" :key="i" :class="`src-${s.kind}`">
            <i />
            <span>{{ describeSource(s) }}</span>
            <span v-if="s.via && s.via.length > 1" class="path mono">{{ s.via.join(" → ") }}</span>
          </li>
        </ul>
        <CheckList :checks="result.checks" :read-only="m.readOnly.value" @fix="fix" />
      </div>
    </section>

    <section v-if="m.caps.value?.loginCheck" class="section">
      <div class="section-head">
        <h3>Login check</h3>
        <span class="hint">Why {{ principal?.name }} can or can't connect</span>
        <div class="grow" />
        <div v-if="loginLoading" class="spinner small" />
        <button class="btn" :disabled="loginLoading" @click="diagnose">
          <Icon :name="loginChecks ? 'refresh' : 'play'" :size="12" /> {{ loginChecks ? "Run again" : "Run" }}
        </button>
      </div>
      <div v-if="loginError" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ loginError }}</span></div>
      <CheckList v-if="loginChecks" :checks="loginChecks" :read-only="m.readOnly.value" @fix="fix" />
      <div v-else-if="!loginLoading" class="empty-note">
        Checks LOGIN, password expiry, connection limits, CONNECT privileges and pg_hba.conf rules.
      </div>
    </section>
  </div>
</template>

<style scoped>
.question {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  margin-bottom: 12px;
}
.question .grow {
  min-width: 260px;
}
.priv select {
  min-width: 110px;
}
.result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.verdict {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: var(--radius);
  font-size: 0.875rem;
}
.verdict.allowed {
  background: color-mix(in srgb, var(--brand-success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand-success) 35%, transparent);
}
.verdict.allowed .icon {
  color: var(--brand-success);
}
.verdict.denied {
  background: color-mix(in srgb, var(--brand-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand-danger) 35%, transparent);
}
.verdict.denied .icon {
  color: var(--brand-danger);
}
.verdict-title {
  font-weight: 700;
  font-size: 1rem;
}
.sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8125rem;
}
.sources li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sources i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--src);
  flex: none;
}
.path {
  color: var(--text-light);
  font-size: 0.75rem;
}
</style>
