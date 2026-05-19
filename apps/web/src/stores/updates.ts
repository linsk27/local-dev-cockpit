import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { checkUpdates, type UpdateCheckResult } from "../api";

const LAST_CHECK_KEY = "dev-cockpit:update-last-check";
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps update state in one place so both the sidebar badge and Settings page
 * reflect the same release check result.
 */
export const useUpdatesStore = defineStore("updates", () => {
  const result = ref<UpdateCheckResult | null>(null);
  const loading = ref(false);
  const error = ref("");
  const hasUpdate = computed(() => Boolean(result.value?.hasUpdate));

  async function check(options: { silent?: boolean; force?: boolean } = {}): Promise<UpdateCheckResult | undefined> {
    if (loading.value) return result.value ?? undefined;
    if (!options.force && options.silent && !shouldAutoCheck()) return result.value ?? undefined;
    loading.value = true;
    if (!options.silent) error.value = "";
    try {
      const next = await checkUpdates();
      result.value = next;
      error.value = next.error ?? "";
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      return next;
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  return { result, loading, error, hasUpdate, check };
});

function shouldAutoCheck(): boolean {
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? "0");
  return !Number.isFinite(last) || Date.now() - last > AUTO_CHECK_INTERVAL_MS;
}
