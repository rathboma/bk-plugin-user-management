<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import { host } from "../../host/host";
import { useManager } from "../../state/inject";
import Icon from "../Icon.vue";
import Modal from "../Modal.vue";

const m = useManager();
const review = computed(() => m.state.review!);
const plan = computed(() => review.value.plan);
const hasSecrets = computed(() => plan.value.statements.some((s) => s.display && s.display !== s.sql));

/** What is shown, copied and opened: secrets stay masked. */
const text = computed(() => plan.value.statements.map((s) => `${s.display ?? s.sql};`).join("\n"));

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    if (!m.readOnly.value) void m.apply();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <Modal :title="plan.title" wide :busy="review.running" @close="m.closeReview()">
    <div v-for="w in plan.warnings" :key="w" class="notice warning">
      <Icon name="warning" :size="14" />
      <span>{{ w }}</span>
    </div>
    <div v-if="!plan.statements.length" class="empty-note">Nothing to change.</div>
    <template v-else>
      <div class="hint">
        {{ plan.statements.length === 1 ? "Runs" : `${plan.statements.length} statements run` }}
        on {{ m.state.server?.database }} as {{ m.state.server?.currentUser }}.
        <template v-if="plan.statements.length > 1 && m.caps.value?.atomic">One transaction: if one fails, none take effect.</template>
      </div>
      <pre class="code sql">{{ text }}</pre>
      <div v-if="hasSecrets" class="hint">
        <Icon name="lock" :size="12" style="display: inline; vertical-align: -2px" /> Passwords are masked here and in
        copied SQL.
      </div>
    </template>
    <div v-if="review.error" class="notice danger" role="alert">
      <Icon name="fail" :size="14" />
      <div>
        <strong>The change failed and nothing was applied.</strong>
        <div class="mono error">{{ review.error }}</div>
      </div>
    </div>
    <template #footer>
      <button class="btn ghost" :disabled="!plan.statements.length" @click="host.copy(text)"><Icon name="copy" :size="14" /> Copy</button>
      <button class="btn ghost" :disabled="!plan.statements.length" @click="host.openQueryTab(text)">
        <Icon name="external" :size="14" /> Open in query tab
      </button>
      <div class="grow" />
      <button class="btn" :disabled="review.running" @click="m.closeReview()">Cancel</button>
      <button
        class="btn primary"
        :disabled="!plan.statements.length || review.running || m.readOnly.value"
        :title="m.readOnly.value ? 'Read-only connection' : 'Ctrl+Enter'"
        @click="m.apply()"
      >
        <span v-if="review.running" class="spinner small" />
        {{ review.error ? "Try again" : "Apply" }}
      </button>
    </template>
  </Modal>
</template>

<style scoped>
.sql {
  max-height: 340px;
}
.error {
  margin-top: 4px;
  white-space: pre-wrap;
}
</style>
