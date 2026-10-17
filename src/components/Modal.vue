<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import Icon from "./Icon.vue";

const props = defineProps<{ title: string; wide?: boolean; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLElement>();

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !props.busy) {
    event.stopPropagation();
    emit("close");
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  // Focus the first field, or the dialog itself.
  const first = dialog.value?.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea");
  (first ?? dialog.value)?.focus();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <div class="modal-backdrop" @mousedown.self="!busy && emit('close')">
    <div ref="dialog" class="modal" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
      <header class="modal-head">
        <h2>{{ title }}</h2>
        <button class="btn ghost icon-only" title="Close" :disabled="busy" @click="emit('close')">
          <Icon name="close" />
        </button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="modal-foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh 16px 16px;
  background: rgba(0, 0, 0, 0.45);
}
.modal {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 88vh;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  outline: none;
}
.modal.wide {
  width: min(820px, 100%);
}
.modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 16px;
  border-bottom: 1px solid var(--border-color);
}
.modal-head h2 {
  flex: 1;
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
}
.modal-body {
  padding: 14px 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-color);
}
</style>
