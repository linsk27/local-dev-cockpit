<template>
  <Teleport to="body">
    <section v-if="notifications.items.length > 0" class="toast-stack" aria-live="polite">
      <button
        v-for="item in notifications.items"
        :key="item.id"
        class="toast"
        :class="`toast-${item.tone}`"
        type="button"
        @click="notifications.dismiss(item.id)"
      >
        <CheckCircle2 v-if="item.tone === 'success'" :size="17" />
        <AlertCircle v-else-if="item.tone === 'error'" :size="17" />
        <Info v-else :size="17" />
        <span>{{ item.message }}</span>
        <X :size="15" />
      </button>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-vue-next";
import { useNotificationsStore } from "../../stores/notifications";

const notifications = useNotificationsStore();
const timers = new Map<string, number>();

watch(
  () => notifications.items.map((item) => item.id).join("|"),
  () => syncDismissTimers(),
  { immediate: true }
);

onBeforeUnmount(() => {
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
});

function syncDismissTimers(): void {
  const visibleIds = new Set(notifications.items.map((item) => item.id));
  for (const [id, timer] of timers) {
    if (!visibleIds.has(id)) {
      window.clearTimeout(timer);
      timers.delete(id);
    }
  }
  for (const item of notifications.items) {
    if (timers.has(item.id)) continue;
    timers.set(
      item.id,
      window.setTimeout(() => {
        notifications.dismiss(item.id);
        timers.delete(item.id);
      }, item.timeoutMs)
    );
  }
}
</script>
