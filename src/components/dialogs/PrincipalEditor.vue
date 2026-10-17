<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { fromDateTimeInput, toDateTimeInput } from "../../core/format";
import type { AttributeDef, AttributeValue, KindDef, PasswordChange, PrincipalDraft } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import FilterList from "../FilterList.vue";
import Icon from "../Icon.vue";
import Modal from "../Modal.vue";

const m = useManager();
const caps = m.caps.value!;
const dialog = m.state.dialog!;
const editing = dialog.type === "edit";
const before = editing ? m.selectedPrincipal.value : undefined;

function defaultsFor(kind: KindDef | undefined): Record<string, AttributeValue> {
  const values: Record<string, AttributeValue> = {};
  for (const def of caps.attributes) values[def.id] = def.default ?? (def.type === "boolean" ? false : null);
  return { ...values, ...(kind?.defaults ?? {}) };
}

const initialKind = dialog.type === "create" ? dialog.kind : (before?.kind ?? caps.kinds[0].id);
const form = reactive({
  name: before?.name ?? "",
  kind: initialKind,
  attributes: before ? { ...before.attributes } : defaultsFor(caps.kinds.find((k) => k.id === initialKind)),
  comment: before?.comment ?? "",
  passwordAction: (editing ? "keep" : "set") as PasswordChange["action"],
  password: "",
  confirm: "",
  memberOf: [] as string[],
});
const submitting = ref(false);
const error = ref("");
const touched = ref(false);

/** The kind the attributes describe, e.g. a role with LOGIN is a user. */
const currentKind = computed(() => {
  const match = caps.kinds.find(
    (k) => k.defaults && Object.entries(k.defaults).every(([id, value]) => form.attributes[id] === value)
  );
  return match?.id ?? form.kind;
});

function setKind(kind: string) {
  form.kind = kind;
  Object.assign(form.attributes, caps.kinds.find((k) => k.id === kind)?.defaults ?? {});
}

const groups = computed(() => {
  const map = new Map<string, AttributeDef[]>();
  for (const def of caps.attributes) {
    if (def.kinds && !def.kinds.includes(currentKind.value)) continue;
    if (!editing && def.create === false) continue;
    if (!map.has(def.group)) map.set(def.group, []);
    map.get(def.group)!.push(def);
  }
  return [...map.entries()];
});

const showPassword = computed(
  () => caps.password.supported && (!caps.password.kinds || caps.password.kinds.includes(currentKind.value))
);

const nameError = computed(() => {
  const { engine, server } = m.need();
  const invalid = engine.validateName(form.name, server);
  if (invalid) return invalid;
  if (form.name !== before?.name && m.state.principals.some((p) => p.name === form.name)) return `${form.name} already exists.`;
  return "";
});

const passwordError = computed(() => {
  if (!showPassword.value || form.passwordAction !== "set") return "";
  if (!editing && !form.password) return "";
  if (!form.password) return "Enter a password.";
  if (form.password !== form.confirm) return "The passwords don't match.";
  return "";
});

const roleChoices = computed(() =>
  m.state.principals
    .filter((p) => p.name !== form.name)
    .map((p) => ({ value: p.name, label: p.name, hint: p.system ? "system" : p.kind === "user" ? "user" : undefined }))
);

function dateValue(def: AttributeDef): string {
  return toDateTimeInput(form.attributes[def.id] as string | null);
}

function setDate(def: AttributeDef, value: string) {
  form.attributes[def.id] = fromDateTimeInput(value);
}

function draft(): PrincipalDraft {
  let password: PasswordChange = { action: "keep" };
  if (showPassword.value) {
    if (form.passwordAction === "set" && form.password) password = { action: "set", value: form.password };
    else if (form.passwordAction === "remove") password = { action: "remove" };
  }
  return {
    name: form.name,
    kind: currentKind.value,
    attributes: { ...form.attributes },
    comment: form.comment.trim() ? form.comment : null,
    password,
    memberOf: editing ? undefined : form.memberOf,
  };
}

async function submit() {
  touched.value = true;
  if (nameError.value || passwordError.value) return;
  const { engine, server } = m.need();
  submitting.value = true;
  error.value = "";
  try {
    const plan = before ? await engine.planUpdate(before, draft(), server) : await engine.planCreate(draft(), server);
    m.review(plan);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    submitting.value = false;
  }
}

const title = editing
  ? `Edit ${before?.name}`
  : `New ${caps.kinds.find((k) => k.id === initialKind)?.singular.toLowerCase() ?? "principal"}`;
</script>

<template>
  <Modal :title="title" wide :busy="submitting" @close="m.closeDialog()">
    <form id="principal-form" class="form" @submit.prevent="submit">
      <div v-if="!editing" class="kinds">
        <label v-for="k in caps.kinds" :key="k.id" class="kind" :class="{ active: form.kind === k.id }">
          <input type="radio" name="kind" :value="k.id" :checked="form.kind === k.id" @change="setKind(k.id)" />
          <Icon :name="k.id === 'user' ? 'user' : 'role'" />
          <span>
            <strong>{{ k.singular }}</strong>
            <span class="hint">{{ k.description }}</span>
          </span>
        </label>
      </div>

      <div class="field">
        <label for="p-name">Name</label>
        <input
          id="p-name"
          v-model="form.name"
          class="input mono"
          :class="{ invalid: touched && nameError }"
          autocomplete="off"
          spellcheck="false"
          :disabled="editing && !caps.rename"
        />
        <div v-if="touched && nameError" class="field-error">{{ nameError }}</div>
        <div v-else-if="editing && form.name !== before?.name" class="hint">Renames {{ before?.name }}.</div>
      </div>

      <div v-if="showPassword" class="field">
        <span class="field-label">Password</span>
        <div v-if="editing" class="segmented">
          <button type="button" :class="{ active: form.passwordAction === 'keep' }" @click="form.passwordAction = 'keep'">Keep</button>
          <button type="button" :class="{ active: form.passwordAction === 'set' }" @click="form.passwordAction = 'set'">Change</button>
          <button type="button" :class="{ active: form.passwordAction === 'remove' }" @click="form.passwordAction = 'remove'">Remove</button>
        </div>
        <div v-if="form.passwordAction === 'set'" class="row wrap">
          <input v-model="form.password" class="input grow" type="password" placeholder="Password" autocomplete="new-password" aria-label="Password" />
          <input v-model="form.confirm" class="input grow" type="password" placeholder="Confirm" autocomplete="new-password" aria-label="Confirm password" />
        </div>
        <div v-if="form.passwordAction === 'remove'" class="hint">Password logins stop working.</div>
        <div v-if="touched && passwordError" class="field-error">{{ passwordError }}</div>
        <div v-else-if="form.passwordAction === 'set' && caps.password.hint" class="hint">
          <Icon name="lock" :size="12" style="display: inline; vertical-align: -2px" /> {{ caps.password.hint }}
        </div>
      </div>

      <div class="groups">
        <fieldset v-for="[group, defs] in groups" :key="group" class="group">
          <legend>{{ group }}</legend>
          <template v-for="def in defs" :key="def.id">
            <label v-if="def.type === 'boolean'" class="check" :class="{ dangerous: def.dangerous, disabled: editing && def.editable === false }">
              <input
                type="checkbox"
                :checked="!!form.attributes[def.id]"
                :disabled="editing && def.editable === false"
                @change="form.attributes[def.id] = ($event.target as HTMLInputElement).checked"
              />
              <span>
                <span class="check-label">{{ def.label }}</span>
                <span v-if="def.description" class="hint desc">{{ def.description }}</span>
              </span>
            </label>
            <div v-else class="field">
              <label :for="`attr-${def.id}`">{{ def.label }}</label>
              <div v-if="def.type === 'datetime'" class="row">
                <input
                  :id="`attr-${def.id}`"
                  class="input grow"
                  type="datetime-local"
                  :value="dateValue(def)"
                  @change="setDate(def, ($event.target as HTMLInputElement).value)"
                />
                <button v-if="form.attributes[def.id]" type="button" class="btn ghost" @click="form.attributes[def.id] = null">
                  {{ def.placeholder ?? "Clear" }}
                </button>
                <span v-else class="hint">{{ def.placeholder }}</span>
              </div>
              <input
                v-else-if="def.type === 'number'"
                :id="`attr-${def.id}`"
                class="input"
                type="number"
                :min="def.min"
                :value="form.attributes[def.id] ?? ''"
                @input="form.attributes[def.id] = ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value)"
              />
              <select v-else-if="def.type === 'select'" :id="`attr-${def.id}`" v-model="form.attributes[def.id]" class="input">
                <option v-for="o in def.options" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <input v-else :id="`attr-${def.id}`" v-model="form.attributes[def.id]" class="input" :placeholder="def.placeholder" />
              <div v-if="def.description" class="hint">{{ def.description }}</div>
            </div>
          </template>
        </fieldset>
      </div>

      <div v-if="!editing && caps.memberships.supported" class="field">
        <span class="field-label">Member of</span>
        <FilterList v-model="form.memberOf" :items="roleChoices" placeholder="Filter roles" empty="No roles yet" />
      </div>

      <div v-if="caps.comments" class="field">
        <label for="p-comment">Comment</label>
        <textarea id="p-comment" v-model="form.comment" class="input" rows="2" placeholder="What is this for?" />
      </div>

      <div v-if="error" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ error }}</span></div>
    </form>
    <template #footer>
      <button class="btn" type="button" @click="m.closeDialog()">Cancel</button>
      <button class="btn primary" type="submit" form="principal-form" :disabled="submitting">Review changes</button>
    </template>
  </Modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.kinds {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.kind {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  cursor: pointer;
}
.kind input {
  display: none;
}
.kind > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.kind.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.group {
  margin: 0;
  padding: 10px 12px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.group legend {
  padding: 0 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}
.desc {
  display: block;
  margin-top: 1px;
}
.check > span {
  display: flex;
  flex-direction: column;
}
</style>
