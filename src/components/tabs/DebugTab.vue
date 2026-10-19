<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { objectLabel } from "../../core/objects";
import type { AccessCheckResult, ChangePlan, LoginDiagnosis, ObjectRef, PrivilegeSource } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import CheckList from "../CheckList.vue";
import CodeText from "../CodeText.vue";
import Icon from "../Icon.vue";
import ObjectPicker from "../ObjectPicker.vue";
import PrincipalLink from "../PrincipalLink.vue";
import SourceChip from "../SourceChip.vue";
import UiSelect from "../UiSelect.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const canLogin = computed(() => !!m.caps.value?.loginCheck && principal.value?.attributes.login === true);
const mode = computed(() => (canLogin.value ? state.debugMode : "access"));

// Access check -------------------------------------------------------------

const types = computed(() => m.caps.value?.objectTypes ?? []);
const type = ref("table");
const object = ref<ObjectRef>();
const privilege = ref("SELECT");
const typeDef = computed(() => types.value.find((t) => t.id === type.value));

const checking = ref(false);
const checkError = ref("");
const result = shallowRef<AccessCheckResult>();
/** The question the result answers, which stays put while the form changes. */
const asked = shallowRef<{ object: ObjectRef; privilege: string }>();

function setType(value: string) {
  type.value = value;
  object.value = undefined;
  if (!typeDef.value?.privileges.some((p) => p.id === privilege.value)) privilege.value = typeDef.value?.privileges[0]?.id ?? "";
}

async function check() {
  if (!principal.value || !object.value) return;
  const { engine, server } = m.need();
  const question = { object: object.value, privilege: privilege.value };
  checking.value = true;
  checkError.value = "";
  try {
    result.value = await engine.checkAccess(m.run, server, m.ctx.value, { principal: principal.value.name, ...question });
    asked.value = question;
  } catch (e) {
    result.value = undefined;
    checkError.value = errorMessage(e);
  } finally {
    checking.value = false;
  }
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

const fixCount = computed(() => result.value?.checks.filter((c) => c.fix).length ?? 0);

/** How a source reads in "Where X comes from". */
function sourceText(s: PrivilegeSource): { before: string; who?: string; after?: string } {
  switch (s.kind) {
    case "superuser":
      return { before: "Superuser", after: "permission checks are skipped" };
    case "owner":
      return s.grantee && s.grantee !== principal.value?.name ? { before: "Owned by", who: s.grantee } : { before: "Owns the object" };
    case "direct":
      return { before: "Granted directly", after: s.grantable ? "with grant option" : "without grant option" };
    case "inherited":
      return { before: "Granted to", who: s.grantee };
    case "predefined":
      return { before: "Built-in role", who: s.grantee };
    case "public":
      return { before: "Granted to PUBLIC", after: "every role has it" };
    default:
      return { before: s.note ?? "Granted in a way this view can't trace" };
  }
}

// Login check --------------------------------------------------------------

const login = shallowRef<LoginDiagnosis>();
const loginLoading = ref(false);
const loginError = ref("");
const checkedAt = ref<number>();
const now = ref(Date.now());
const timer = setInterval(() => (now.value = Date.now()), 30_000);
onBeforeUnmount(() => clearInterval(timer));

const checkedLabel = computed(() => {
  if (!checkedAt.value) return "";
  const minutes = Math.floor((now.value - checkedAt.value) / 60_000);
  if (minutes < 1) return "checked just now";
  return minutes === 1 ? "checked 1 minute ago" : `checked ${minutes} minutes ago`;
});

async function diagnose() {
  if (!principal.value) return;
  const { engine, server } = m.need();
  loginLoading.value = true;
  loginError.value = "";
  try {
    login.value = await engine.diagnoseLogin(m.run, server, m.ctx.value, principal.value);
    checkedAt.value = Date.now();
    now.value = Date.now();
  } catch (e) {
    login.value = undefined;
    loginError.value = errorMessage(e);
  } finally {
    loginLoading.value = false;
  }
}

function fix(plan: ChangePlan) {
  m.review(plan);
}

onMounted(() => {
  applyQuestion();
  if (mode.value === "login") void diagnose();
});
watch(() => state.question, applyQuestion);
watch(mode, (value) => {
  if (value === "login" && !login.value && !loginLoading.value) void diagnose();
});
watch(
  () => state.revision,
  () => {
    if (result.value && asked.value) {
      object.value = asked.value.object;
      privilege.value = asked.value.privilege;
      void check();
    }
    if (login.value) void diagnose();
  }
);
</script>

<template>
  <div class="debug">
    <div class="mode-row">
      <div v-if="canLogin" class="segmented" role="tablist">
        <button :class="{ active: mode === 'access' }" role="tab" :aria-selected="mode === 'access'" @click="m.setDebugMode('access')">
          Access check
        </button>
        <button :class="{ active: mode === 'login' }" role="tab" :aria-selected="mode === 'login'" @click="m.setDebugMode('login')">
          Login check
        </button>
      </div>
      <span v-else class="mode-title">Access check</span>
      <span class="hint">
        <template v-if="mode === 'login'">Why {{ principal?.name }} can or can't connect<template v-if="checkedLabel"> · {{ checkedLabel }}</template></template>
        <template v-else-if="canLogin || !m.caps.value?.loginCheck">Checks one privilege and everything access depends on</template>
        <template v-else>Checks one privilege and everything access depends on. Roles can't log in, so there is no login check.</template>
      </span>
      <button v-if="mode === 'login'" class="btn" :disabled="loginLoading" @click="diagnose">
        <span v-if="loginLoading" class="spinner small" /><Icon v-else name="refresh" />Run again
      </button>
    </div>

    <!-- Access ------------------------------------------------------------ -->
    <template v-if="mode === 'access'">
      <form class="question" @submit.prevent="check">
        <span>Can <span class="who">{{ principal?.name }}</span></span>
        <UiSelect v-model="privilege" mono label="Privilege">
          <option v-for="p in typeDef?.privileges ?? []" :key="p.id" :value="p.id" :title="p.description">{{ p.id }}</option>
        </UiSelect>
        <span>on</span>
        <UiSelect :model-value="type" label="Object type" @update:model-value="setType">
          <option v-for="t in types" :key="t.id" :value="t.id">{{ t.label.toLowerCase() }}</option>
        </UiSelect>
        <ObjectPicker :key="type" v-model="object" :type="type" min-width="300px" />
        <span>?</span>
        <button class="btn primary" type="submit" :disabled="!object || checking">
          <span v-if="checking" class="spinner small" /><Icon v-else name="play" />Check
        </button>
      </form>

      <div v-if="checkError" class="notice danger section"><Icon name="fail" /><span class="mono">{{ checkError }}</span></div>

      <template v-if="result && asked">
        <div class="alert section">
          <Icon :name="result.allowed ? 'ok' : 'fail'" :class="result.allowed ? 'status-ok' : 'status-fail'" />
          <div class="grow">
            <span class="verdict" :class="result.allowed ? 'status-ok' : 'status-fail'">{{ result.allowed ? "Yes." : "No." }}</span>
            {{ " " }}<CodeText :text="result.summary" />
          </div>
          <div class="actions">
            <button v-for="f in result.fixes" :key="f.title" class="btn" :disabled="m.readOnly.value" @click="fix(f)">
              <Icon name="fix" />{{ f.title }}
            </button>
            <button v-if="result.allowed" class="btn" @click="m.showObject(asked.object)">
              <Icon name="grid_on" />Who else can access {{ objectLabel(asked.object) }}
            </button>
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <span class="title">Where {{ asked.privilege }} comes from</span>
            <span class="pill">{{ result.cell.sources.length }}</span>
          </div>
          <div v-if="result.cell.sources.length" class="box">
            <div v-for="(s, i) in result.cell.sources" :key="i" class="source">
              <SourceChip :source="s" />
              <span class="source-text">
                {{ sourceText(s).before }}<template v-if="sourceText(s).who">&nbsp;<PrincipalLink :name="sourceText(s).who!" /></template>
              </span>
              <span v-if="s.needsSetRole" class="muted">· usable only after SET ROLE</span>
              <span v-else-if="sourceText(s).after" class="muted">· {{ sourceText(s).after }}</span>
              <span class="grow" />
              <button v-if="s.kind === 'direct'" class="link quiet" @click="m.setTab('grants')">Revoke under Direct grants</button>
              <span v-else-if="s.via && s.via.length > 1" class="path mono">{{ s.via.join(" → ") }}</span>
            </div>
          </div>
          <div v-else class="box empty">
            <div class="lead">No grant gives {{ principal?.name }} {{ asked.privilege }} on {{ objectLabel(asked.object) }}.</div>
            <div class="sub">Not directly, not through a role, and not through PUBLIC.</div>
          </div>
        </div>

        <div class="section">
          <div class="section-head">
            <span class="title">What access depends on</span>
            <span class="pill">{{ result.checks.length }}</span>
            <span class="hint">{{ fixCount ? "Every fix opens the review dialog first" : "Nothing to fix" }}</span>
          </div>
          <CheckList :checks="result.checks" :read-only="m.readOnly.value" @fix="fix" />
        </div>
      </template>
      <div v-else-if="!checking && !checkError" class="box empty">
        <div class="lead">Pick a privilege and an object, then Check.</div>
        <div class="sub">
          The answer comes from the database itself, with where the privilege comes from and what else access depends on.
          Chips in the Access tab open here with the question filled in.
        </div>
      </div>
    </template>

    <!-- Login ------------------------------------------------------------- -->
    <template v-else>
      <div v-if="loginError" class="notice danger section"><Icon name="fail" /><span class="mono">{{ loginError }}</span></div>
      <div v-if="loginLoading && !login" class="spinner" />
      <template v-if="login">
        <div class="alert section">
          <Icon
            :name="login.verdict === 'yes' ? 'ok' : login.verdict === 'no' ? 'fail' : 'unknown'"
            :class="`status-${login.verdict === 'yes' ? 'ok' : login.verdict === 'no' ? 'fail' : 'unknown'}`"
          />
          <div class="grow">
            <span class="verdict" :class="`status-${login.verdict === 'yes' ? 'ok' : login.verdict === 'no' ? 'fail' : 'unknown'}`">
              {{ login.verdict === "yes" ? "Yes." : login.verdict === "no" ? "No." : "Not sure." }}
            </span>
            {{ " " }}<CodeText :text="login.summary" />
          </div>
          <div v-if="login.fixes.length || login.suggestPassword" class="actions">
            <button v-for="f in login.fixes" :key="f.title" class="btn" :disabled="m.readOnly.value" @click="fix(f)">
              <Icon name="fix" />{{ f.title }}
            </button>
            <button
              v-if="login.suggestPassword"
              class="btn"
              :disabled="m.readOnly.value"
              @click="m.openDialog({ type: 'edit', password: true })"
            >
              <Icon name="key" />Set a new password
            </button>
          </div>
        </div>
        <div class="section">
          <div class="section-head">
            <span class="title">What login depends on</span>
            <span class="pill">{{ login.checks.length }}</span>
            <span class="hint">
              {{ state.server?.isSuperuser ? "Read from the server's catalogs and pg_hba.conf" : "Server-side checks need a superuser; otherwise they show as unknown" }}
            </span>
          </div>
          <CheckList :checks="login.checks" :read-only="m.readOnly.value" @fix="fix" />
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.mode-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.mode-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-dark);
}
.mode-row .hint {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-light);
}
.question {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  font-size: 14px;
  color: var(--text);
}
.question .btn {
  margin-left: 4px;
}
.who {
  font-weight: 500;
  color: var(--text-dark);
}
.alert {
  margin-bottom: 18px;
}
.source {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 13px;
  color: var(--text-dark);
}
.source:last-child {
  border-bottom: 0;
}
.source-text {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.source .muted {
  color: var(--text-light);
  white-space: nowrap;
}
.path {
  font-size: 12px;
  color: var(--text-light);
  white-space: nowrap;
}
</style>
