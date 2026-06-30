import { computed, ref } from "vue";
import { usePreferencesStore } from "../../stores/preferences";
import { useResourcesStore } from "../../stores/resources";

export function useResourceCapture() {
  const resources = useResourcesStore();
  const preferences = usePreferencesStore();
  const sourceUrl = ref("");
  const sourceText = ref("");
  const captureDialogOpen = ref(false);
  const canSubmit = computed(() => sourceUrl.value.trim().length > 0 || sourceText.value.trim().length > 0);

  function openCaptureDialog(): void {
    captureDialogOpen.value = true;
    resources.clearPreview();
  }

  function closeCaptureDialog(): void {
    resources.clearPreview();
    captureDialogOpen.value = false;
  }

  async function submitResource(): Promise<boolean> {
    captureDialogOpen.value = true;
    if (!canSubmit.value) {
      resources.setError(preferences.t("resourceInputRequired"));
      return false;
    }
    return Boolean(
      await resources.preview({
        sourceUrl: sourceUrl.value,
        sourceText: sourceText.value,
        outputLocale: preferences.locale
      })
    );
  }

  async function commitPreview(): Promise<boolean> {
    const created = await resources.commitPreview();
    if (!created) return false;
    sourceUrl.value = "";
    sourceText.value = "";
    captureDialogOpen.value = false;
    return true;
  }

  function cancelPreview(): void {
    resources.clearPreview();
    captureDialogOpen.value = false;
  }

  return {
    canSubmit,
    cancelPreview,
    captureDialogOpen,
    closeCaptureDialog,
    commitPreview,
    openCaptureDialog,
    sourceText,
    sourceUrl,
    submitResource
  };
}
