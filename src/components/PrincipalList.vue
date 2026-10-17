<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useManager } from "../state/inject";
import Icon from "./Icon.vue";

const m = useManager();
const { state } = m;
const list = ref<HTMLElement>();

const groups = computed(() => {
  const kinds = m.caps.value?.kinds ?? [];
  const items = m.filteredPrincipals.value;
  const result = kinds.map((kind) => ({
    id: kind.id,
    label: kind.label,
    singular: kind.singular,
    items: items.filter((p) => p.kind === kind.id && !p.system),
  }));
  if (state.showSystem) {
    result.push({ id: "system", label: "System", singular: "System role", items: items.filter((p) => p.system) });
  }
  return result;
});

const flat = computed(() => groups.value.flatMap((g) => g.items));
const systemCount = computed(() => state.principals.filter((p) => p.system).length);

function move(delta: number) {
  const items = flat.value;
  if (!items.length) return;
  const index = items.findIndex((p) => p.id === state.selected);
  const next = items[Math.min(items.length - 1, Math.max(0, index + delta))];
  void m.select(next.id);
  void nextTick(() => list.value?.querySelector<HTMLElement>(".item.selected")?.scrollIntoView({ block: "nearest" }));
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  }
}
</script>

<template>
  <aside class="sidebar">
    <div class="search">
      <Icon name="search" :size="14" class="search-icon" />
      <input
        v-model="state.search"
        class="input"
        type="search"
        placeholder="Filter users and roles"
        aria-label="Filter users and roles"
        @keydown="onKeydown"
      />
    </div>
    <div class="new">
      <button
        v-for="kind in m.caps.value?.kinds ?? []"
        :key="kind.id"
        class="btn"
        :title="kind.description"
        @click="m.openDialog({ type: 'create', kind: kind.id })"
      >
        <Icon name="plus" :size="14" /> {{ kind.singular }}
      </button>
    </div>
    <div ref="list" class="list" tabindex="0" role="listbox" aria-label="Users and roles" @keydown="onKeydown">
      <section v-for="group in groups" :key="group.id" class="group">
        <h4>
          {{ group.label }} <span class="count">{{ group.items.length }}</span>
        </h4>
        <button
          v-for="p in group.items"
          :key="p.id"
          class="item"
          role="option"
          :aria-selected="p.id === state.selected && state.view === 'principals'"
          :class="{ selected: p.id === state.selected && state.view === 'principals' }"
          :title="p.comment ?? p.name"
          @click="m.select(p.id)"
        >
          <Icon :name="p.system ? 'system' : p.kind === 'user' ? 'user' : 'role'" :size="14" class="kind-icon" />
          <span class="name">{{ p.name }}</span>
          <span v-if="p.sessions" class="sessions" :title="`${p.sessions} open sessions`">{{ p.sessions }}</span>
          <span
            v-for="b in p.badges.filter((b) => b.tone === 'danger' || b.tone === 'warning').slice(0, 1)"
            :key="b.label"
            class="badge"
            :class="b.tone"
            :title="b.title"
            >{{ b.label }}</span
          >
        </button>
        <div v-if="!group.items.length" class="none">
          {{ state.search ? "No matches" : `No ${group.label.toLowerCase()}` }}
        </div>
      </section>
    </div>
    <label class="check system-toggle">
      <input type="checkbox" :checked="state.showSystem" @change="m.setShowSystem(($event.target as HTMLInputElement).checked)" />
      <span>Show system roles <span class="muted">({{ systemCount }})</span></span>
    </label>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 250px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  min-height: 0;
}
.search {
  position: relative;
  padding: 10px 10px 6px;
}
.search .input {
  width: 100%;
  padding-left: 28px;
}
.search-icon {
  position: absolute;
  left: 19px;
  top: 17px;
  color: var(--text-lighter);
}
.new {
  display: flex;
  gap: 6px;
  padding: 0 10px 8px;
}
.new .btn {
  flex: 1;
  justify-content: center;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 0 6px 8px;
  outline: none;
}
.group h4 {
  margin: 10px 6px 4px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-light);
}
.group .count {
  color: var(--text-lighter);
  margin-left: 4px;
}
.item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dark);
  font: inherit;
  font-size: 0.8125rem;
  text-align: left;
  cursor: pointer;
}
.item:hover {
  background: var(--subtle);
}
.item.selected {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.kind-icon {
  color: var(--text-light);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sessions {
  font-size: 0.6875rem;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--brand-success) 20%, transparent);
  color: var(--brand-success);
  text-align: center;
  line-height: 16px;
  font-weight: 600;
}
.none {
  padding: 4px 8px 6px;
  color: var(--text-lighter);
  font-size: 0.75rem;
}
.system-toggle {
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  font-size: 0.75rem;
  align-items: center;
}
.system-toggle input {
  margin: 0;
}
</style>
