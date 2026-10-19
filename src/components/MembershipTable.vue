<script setup lang="ts">
import { computed } from "vue";
import type { Membership } from "../engines/types";
import { useManager } from "../state/inject";
import Icon from "./Icon.vue";
import PrincipalLink from "./PrincipalLink.vue";

/**
 * Memberships with their options as checkboxes. Ticking a box queues the
 * change; the pending bar sends every queued change to one review.
 */
const props = defineProps<{ memberships: Membership[]; side: "role" | "member" }>();
const m = useManager();
const options = computed(() => m.caps.value?.memberships.options ?? []);

const nameOf = (x: Membership) => (props.side === "role" ? x.role : x.member);
const badgeOf = (x: Membership) =>
  m.state.principals.find((p) => p.name === nameOf(x))?.badges.find((b) => b.tone === "warning" || b.tone === "danger");

function value(x: Membership, option: string): boolean {
  return m.pendingOption(x, option) ?? x.options[option] ?? false;
}

function remove(x: Membership) {
  const { engine, server } = m.need();
  m.review(engine.planMemberships([{ action: "remove", membership: x }], server));
}
</script>

<template>
  <div class="box">
    <table class="table">
      <thead>
        <tr>
          <th>{{ side === "role" ? "Role" : "Member" }}</th>
          <th v-for="o in options" :key="o.id" class="center" style="width: 90px" :title="o.description">{{ o.label }}</th>
          <th style="width: 160px">Granted by</th>
          <th style="width: 44px" />
        </tr>
      </thead>
      <tbody>
        <tr v-for="x in memberships" :key="`${x.role}:${x.member}:${x.grantor}`">
          <td>
            <PrincipalLink :name="nameOf(x)" />
            <span v-if="badgeOf(x)" class="tag badge" :class="badgeOf(x)!.tone" :title="badgeOf(x)!.title">{{ badgeOf(x)!.label }}</span>
          </td>
          <td
            v-for="o in options"
            :key="o.id"
            class="center"
            :class="{ pending: m.pendingOption(x, o.id) !== undefined }"
            :title="m.pendingOption(x, o.id) !== undefined ? `Pending: ${o.label.toLowerCase()} option` : o.description"
          >
            <input
              type="checkbox"
              :checked="value(x, o.id)"
              :disabled="m.readOnly.value"
              :aria-label="`${o.label} for ${nameOf(x)}`"
              @change="m.queueMembership(x, o.id, ($event.target as HTMLInputElement).checked)"
            />
          </td>
          <td>{{ x.grantor ?? "—" }}</td>
          <td class="actions">
            <button
              class="remove"
              :disabled="m.readOnly.value"
              :title="side === 'role' ? `Remove from ${x.role}` : `Remove ${x.member}`"
              @click="remove(x)"
            >
              <Icon name="close" :size="16" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table td:first-child {
  color: var(--text-dark);
}
.badge {
  margin-left: 8px;
}
.remove {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-lighter);
  cursor: pointer;
}
.remove:hover:not(:disabled) {
  color: var(--text-dark);
}
.remove:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
