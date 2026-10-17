<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { wouldCreateCycle } from "../../core/graph";
import type { MembershipChange } from "../../engines/types";
import { useManager } from "../../state/inject";
import FilterList from "../FilterList.vue";
import Modal from "../Modal.vue";

const m = useManager();
const principal = m.selectedPrincipal.value!;
const dialog = m.state.dialog as { type: "membership"; direction: "memberOf" | "members" };
const toRoles = dialog.direction === "memberOf";
const optionDefs = m.caps.value?.memberships.options ?? [];
const options = reactive(Object.fromEntries(optionDefs.map((o) => [o.id, o.default])) as Record<string, boolean>);
const chosen = ref<string[]>([]);

const items = computed(() =>
  m.state.principals
    .filter((p) => p.name !== principal.name)
    .map((p) => {
      const role = toRoles ? p.name : principal.name;
      const member = toRoles ? principal.name : p.name;
      const exists = m.state.memberships.some((x) => x.role === role && x.member === member);
      const cycle = !exists && wouldCreateCycle(role, member, m.state.memberships);
      return {
        value: p.name,
        label: p.name,
        hint: exists ? "already" : cycle ? "would create a loop" : p.system ? "system" : p.kind === "user" ? "user" : undefined,
        disabled: exists || cycle,
      };
    })
    .sort((a, b) => Number(a.disabled) - Number(b.disabled))
);

function submit() {
  const { engine, server } = m.need();
  const changes: MembershipChange[] = chosen.value.map((name) => ({
    action: "add",
    role: toRoles ? name : principal.name,
    member: toRoles ? principal.name : name,
    options: { ...options },
  }));
  m.review(engine.planMemberships(changes, server));
}
</script>

<template>
  <Modal :title="toRoles ? `Add ${principal.name} to roles` : `Add members to ${principal.name}`" @close="m.closeDialog()">
    <div class="field">
      <span class="field-label">{{ toRoles ? "Roles" : "Members" }}</span>
      <FilterList v-model="chosen" :items="items" />
    </div>
    <div v-if="optionDefs.length" class="field">
      <span class="field-label">Options</span>
      <label v-for="o in optionDefs" :key="o.id" class="check">
        <input v-model="options[o.id]" type="checkbox" />
        <span>
          <span class="check-label">{{ o.label }}</span>
          <span class="hint desc">{{ o.description }}</span>
        </span>
      </label>
    </div>
    <template #footer>
      <button class="btn" @click="m.closeDialog()">Cancel</button>
      <button class="btn primary" :disabled="!chosen.length" @click="submit">Review</button>
    </template>
  </Modal>
</template>

<style scoped>
.check > span {
  display: flex;
  flex-direction: column;
}
</style>
