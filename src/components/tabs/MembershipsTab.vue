<script setup lang="ts">
import { computed } from "vue";
import { reachableRoles } from "../../core/graph";
import type { Membership } from "../../engines/types";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";

const m = useManager();
const { state } = m;
const principal = m.selectedPrincipal;
const options = computed(() => m.caps.value?.memberships.options ?? []);

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

function toggle(membership: Membership, option: string, event: Event) {
  // The box shows the current state until the change is applied.
  const input = event.target as HTMLInputElement;
  const value = input.checked;
  input.checked = !value;
  const { engine, server } = m.need();
  m.review(
    engine.planMemberships([{ action: "update", membership, options: { ...membership.options, [option]: value } }], server)
  );
}

function remove(membership: Membership) {
  const { engine, server } = m.need();
  m.review(engine.planMemberships([{ action: "remove", membership }], server));
}
</script>

<template>
  <div>
    <section class="section">
      <div class="section-head">
        <h3>Member of <span class="count">{{ memberOf.length }}</span></h3>
        <span class="hint">Roles whose privileges {{ principal?.name }} can use</span>
        <div class="grow" />
        <button class="btn" @click="m.openDialog({ type: 'membership', direction: 'memberOf' })">
          <Icon name="plus" :size="14" /> Add to role
        </button>
      </div>
      <div v-if="!memberOf.length" class="empty-note">Not a member of any role.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Role</th>
              <th v-for="o in options" :key="o.id" class="center" :title="o.description">{{ o.label }}</th>
              <th>Granted by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in memberOf" :key="`${x.role}:${x.grantor}`">
              <td><button class="link" @click="m.select(x.role)">{{ x.role }}</button></td>
              <td v-for="o in options" :key="o.id" class="center">
                <input
                  type="checkbox"
                  :checked="x.options[o.id] ?? false"
                  :title="o.description"
                  :aria-label="`${o.label} for ${x.role}`"
                  @change="toggle(x, o.id, $event)"
                />
              </td>
              <td class="muted">{{ x.grantor ?? "—" }}</td>
              <td class="actions">
                <button class="btn ghost icon-only" :title="`Remove from ${x.role}`" @click="remove(x)">
                  <Icon name="close" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h3>Members <span class="count">{{ members.length }}</span></h3>
        <span class="hint">Users and roles that belong to {{ principal?.name }}</span>
        <div class="grow" />
        <button class="btn" @click="m.openDialog({ type: 'membership', direction: 'members' })">
          <Icon name="plus" :size="14" /> Add members
        </button>
      </div>
      <div v-if="!members.length" class="empty-note">No members.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Member</th>
              <th v-for="o in options" :key="o.id" class="center" :title="o.description">{{ o.label }}</th>
              <th>Granted by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in members" :key="`${x.member}:${x.grantor}`">
              <td><button class="link" @click="m.select(x.member)">{{ x.member }}</button></td>
              <td v-for="o in options" :key="o.id" class="center">
                <input
                  type="checkbox"
                  :checked="x.options[o.id] ?? false"
                  :title="o.description"
                  :aria-label="`${o.label} for ${x.member}`"
                  @change="toggle(x, o.id, $event)"
                />
              </td>
              <td class="muted">{{ x.grantor ?? "—" }}</td>
              <td class="actions">
                <button class="btn ghost icon-only" :title="`Remove ${x.member}`" @click="remove(x)">
                  <Icon name="close" :size="14" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h3>All roles it belongs to <span class="count">{{ effective.length }}</span></h3>
        <span class="hint">Direct and indirect memberships</span>
      </div>
      <div v-if="!effective.length" class="empty-note">None.</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr><th>Role</th><th>Through</th><th>Privileges</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in effective" :key="r.role">
              <td><button class="link" @click="m.select(r.role)">{{ r.role }}</button></td>
              <td class="muted">{{ r.depth === 1 ? "Direct" : r.path.slice(1, -1).join(" → ") }}</td>
              <td>
                <span v-if="r.inherited" class="badge success">Inherited</span>
                <span v-else-if="r.settable" class="badge warning" title="Not inherited: available after SET ROLE">SET ROLE only</span>
                <span v-else class="badge" title="Neither inherited nor settable">Not usable</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

