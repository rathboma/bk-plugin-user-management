<script setup lang="ts">
import { computed } from "vue";
import { reachableRoles } from "../../core/graph";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";
import MembershipTable from "../MembershipTable.vue";
import PrincipalLink from "../PrincipalLink.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;

const memberOf = computed(() => state.memberships.filter((x) => x.member === principal.value?.name));
const members = computed(() => state.memberships.filter((x) => x.role === principal.value?.name));

const effective = computed(() => {
  if (!principal.value) return [];
  const reach = reachableRoles(principal.value.name, state.memberships, {
    inherits: (x) => x.options.inherit !== false,
    settable: (x) => x.options.set !== false,
  });
  return [...reach.values()].sort((a, b) => a.depth - b.depth || a.role.localeCompare(b.role));
});
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <span class="title">Member of</span>
        <span class="pill">{{ memberOf.length }}</span>
        <span class="hint">Roles whose privileges {{ principal?.name }} can use</span>
        <button class="btn" :disabled="m.readOnly.value" @click="m.openDialog({ type: 'membership', direction: 'memberOf' })">
          <Icon name="add" />Add to role
        </button>
      </div>
      <MembershipTable v-if="memberOf.length" :memberships="memberOf" side="role" />
      <div v-else class="box note">{{ principal?.name }} belongs to no roles. Adding it to a role gives it that role's privileges.</div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="title">Members</span>
        <span class="pill">{{ members.length }}</span>
        <span class="hint">Users and roles that belong to {{ principal?.name }}</span>
        <button class="btn" :disabled="m.readOnly.value" @click="m.openDialog({ type: 'membership', direction: 'members' })">
          <Icon name="add" />Add members
        </button>
      </div>
      <MembershipTable v-if="members.length" :memberships="members" side="member" />
      <div v-else class="box note">Nothing belongs to {{ principal?.name }}. Adding members lets other roles act as {{ principal?.name }}.</div>
    </section>

    <section v-if="effective.length" class="section">
      <div class="section-head">
        <span class="title">All roles it belongs to</span>
        <span class="pill">{{ effective.length }}</span>
        <span class="hint">Direct and indirect memberships</span>
      </div>
      <div class="box">
        <table class="table">
          <thead>
            <tr>
              <th>Role</th>
              <th style="width: 40%">Through</th>
              <th style="width: 200px">Privileges</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in effective" :key="r.role">
              <td><PrincipalLink :name="r.role" /></td>
              <td v-if="r.depth === 1">Direct</td>
              <td v-else class="mono path">{{ r.path.join(" → ") }}</td>
              <td>
                <span v-if="r.inherited" class="usable"><Icon name="ok" :size="16" class="status-ok" />Inherited</span>
                <span v-else-if="r.settable" class="usable" title="Not inherited: usable after SET ROLE">
                  <Icon name="warning" :size="16" class="status-warn" />After SET ROLE
                </span>
                <span v-else class="usable" title="Neither inherited nor settable">
                  <Icon name="block" :size="16" class="status-unknown" />Not usable
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.section-head .hint {
  font-size: 12.5px;
}
.path {
  font-size: 12px;
}
.usable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-dark);
}
</style>
