<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useManager } from "../state/inject";
import Icon from "./Icon.vue";
import PrincipalIcon from "./PrincipalIcon.vue";

const m = useManager();
const { state } = m;
const list = ref<HTMLElement>();

const groups = computed(() => {
  const kinds = m.caps.value?.kinds ?? [];
  const items = m.filteredPrincipals.value;
  const result = kinds.map((kind) => ({
    id: kind.id,
    label: kind.label,
    newLabel: `New ${kind.singular.toLowerCase()}`,
    canCreate: true,
    items: items.filter((p) => p.kind === kind.id && !p.system),
  }));
  if (state.showSystem) {
    result.push({ id: "system", label: "System", newLabel: "", canCreate: false, items: items.filter((p) => p.system) });
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
    <div class="search-field filter">
      <Icon name="search" />
      <input
        v-model="state.search"
        class="input"
        type="search"
        placeholder="Filter users and roles"
        aria-label="Filter users and roles"
        @keydown="onKeydown"
      />
    </div>
    <div ref="list" class="list" tabindex="0" role="listbox" aria-label="Users and roles" @keydown="onKeydown">
      <section v-for="group in groups" :key="group.id" class="group">
        <div class="group-head">
          {{ group.label }}<span class="pill">{{ group.items.length }}</span>
          <span class="grow" />
          <button
            v-if="group.canCreate"
            class="add"
            type="button"
            :title="group.newLabel"
            :aria-label="group.newLabel"
            @click="m.openDialog({ type: 'create', kind: group.id })"
          >
            <Icon name="add" />
          </button>
        </div>
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
          <PrincipalIcon :kind="p.kind" :system="p.system" :size="18" />
          <span class="name">{{ p.name }}</span>
          <span v-if="p.sessions" class="pill quiet" :title="`${p.sessions} open sessions`"
            ><i class="material-icons dot">circle</i>{{ p.sessions }}</span
          >
          <span
            v-for="b in p.badges.filter((b) => b.tone === 'danger' || b.tone === 'warning').slice(0, 1)"
            :key="b.label"
            class="tag"
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
    <label class="check inline toggle">
      <input type="checkbox" :checked="state.showSystem" @change="m.setShowSystem(($event.target as HTMLInputElement).checked)" />
      <span>Show system roles</span><span class="faint">{{ systemCount }}</span>
    </label>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 260px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}
.filter {
  margin: 10px 12px 4px;
}
.filter .input {
  height: 26px;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 0 6px 8px;
  outline: none;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 6px 6px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-dark);
}
.add {
  display: inline-flex;
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-light);
  cursor: pointer;
}
.add:hover {
  color: var(--text-dark);
}
.item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28.8px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-dark);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
}
.item:hover {
  background: var(--tint-3);
}
.item.selected {
  background: var(--tint-4);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.none {
  padding: 2px 6px 6px;
  color: var(--text-lighter);
  font-size: 12.5px;
}
.toggle {
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
  color: var(--text);
}
</style>
