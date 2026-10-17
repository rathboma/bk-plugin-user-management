<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef } from "vue";
import type { DropInfo } from "../../engines/types";
import { errorMessage } from "../../host/host";
import { useManager } from "../../state/inject";
import CheckList from "../CheckList.vue";
import Icon from "../Icon.vue";
import Modal from "../Modal.vue";

const m = useManager();
const principal = m.selectedPrincipal.value!;
const info = shallowRef<DropInfo>();
const error = ref("");
const options = reactive({ reassign: false, reassignTo: m.state.server?.currentUser ?? "", dropOwned: false, terminateSessions: false });

const hints = m.caps.value!.drop;
const others = computed(() => m.state.principals.filter((p) => p.name !== principal.name && !p.system));
const members = computed(() => m.state.memberships.filter((x) => x.role === principal.name).length);

onMounted(async () => {
  const { engine, server } = m.need();
  try {
    info.value = await engine.dropInfo(m.run, server, principal);
    options.reassign = info.value.suggested.reassign;
    options.dropOwned = info.value.suggested.dropOwned;
  } catch (e) {
    error.value = errorMessage(e);
  }
});

function submit() {
  const { engine, server } = m.need();
  m.review(
    engine.planDrop(
      principal,
      {
        reassignTo: options.reassign && options.reassignTo ? options.reassignTo : undefined,
        dropOwned: options.dropOwned,
        terminateSessions: options.terminateSessions,
      },
      server
    )
  );
}
</script>

<template>
  <Modal :title="`Drop ${principal.name}`" @close="m.closeDialog()">
    <div v-if="!info && !error" class="row"><div class="spinner small" /> Checking what depends on {{ principal.name }}…</div>
    <div v-if="error" class="notice danger"><Icon name="fail" :size="14" /><span class="mono">{{ error }}</span></div>
    <template v-if="info">
      <CheckList v-if="info.checks.length" :checks="info.checks" />
      <div v-else class="notice"><Icon name="ok" :size="14" /><span>Nothing depends on {{ principal.name }} in this database.</span></div>
      <p v-if="members" class="hint">{{ members }} members lose their membership in {{ principal.name }}.</p>

      <div class="options">
        <label v-if="hints.reassign" class="check">
          <input v-model="options.reassign" type="checkbox" />
          <span>
            <span class="check-label">Give its objects to another role first</span>
            <span class="hint">{{ hints.reassign }}</span>
          </span>
        </label>
        <select v-if="options.reassign" v-model="options.reassignTo" class="input indent" aria-label="New owner">
          <option v-for="p in others" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <label v-if="hints.dropOwned" class="check">
          <input v-model="options.dropOwned" type="checkbox" />
          <span>
            <span class="check-label">{{ options.reassign ? "Then revoke its privileges" : "Drop its objects and revoke its privileges" }}</span>
            <span class="hint">{{ hints.dropOwned }}</span>
          </span>
        </label>
        <label v-if="info.sessions" class="check">
          <input v-model="options.terminateSessions" type="checkbox" />
          <span>
            <span class="check-label">Terminate its {{ info.sessions }} open sessions</span>
          </span>
        </label>
      </div>
    </template>
    <template #footer>
      <button class="btn" @click="m.closeDialog()">Cancel</button>
      <button class="btn primary" :disabled="!info || (options.reassign && !options.reassignTo)" @click="submit">Review</button>
    </template>
  </Modal>
</template>

<style scoped>
.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.check > span {
  display: flex;
  flex-direction: column;
}
.indent {
  margin-left: 22px;
  align-self: flex-start;
  min-width: 200px;
}
</style>
