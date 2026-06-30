import { ref, type ComputedRef } from "vue";
import type { RadarItem, ResourceStatus } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useResourcesStore } from "../../stores/resources";
import { isResourceStatus } from "./resource-display";

export function useResourceActions(selected: ComputedRef<RadarItem | undefined>) {
  const resources = useResourcesStore();
  const preferences = usePreferencesStore();
  const notifications = useNotificationsStore();
  const copyingContext = ref(false);

  async function setStatus(value: ResourceStatus): Promise<void> {
    const item = selected.value;
    if (!item || !isResourceStatus(value)) return;
    await resources.update(item.id, { status: value });
  }

  async function removeSelected(): Promise<void> {
    const item = selected.value;
    if (!item) return;
    await resources.remove(item.id);
  }

  async function copyContext(): Promise<boolean> {
    if (copyingContext.value) return false;
    copyingContext.value = true;
    try {
      const context = await resources.loadContext();
      if (!context) {
        notifications.error(resources.error || preferences.t("resourceCopyContextFailed"));
        return false;
      }
      await navigator.clipboard.writeText(context);
      notifications.success(preferences.t("resourceContextCopied"));
      return true;
    } catch (error) {
      notifications.error(
        preferences.t("resourceCopyContextFailedWithMessage", { message: error instanceof Error ? error.message : String(error) })
      );
      return false;
    } finally {
      copyingContext.value = false;
    }
  }

  async function copySourceUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      notifications.success(preferences.t("resourceSourceCopied"));
    } catch (error) {
      notifications.error(
        preferences.t("resourceSourceCopyFailedWithMessage", { message: error instanceof Error ? error.message : String(error) })
      );
    }
  }

  return {
    copyingContext,
    copyContext,
    copySourceUrl,
    removeSelected,
    setStatus
  };
}
