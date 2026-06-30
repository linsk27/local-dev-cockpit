import { computed } from "vue";
import { usePreferencesStore } from "../../stores/preferences";
import { useResourcesStore } from "../../stores/resources";
import { sourcePreviewText, toReadableBlocks } from "./resource-display";
import { getResourceRelations } from "./resource-insights";

export function useResourceSelection() {
  const resources = useResourcesStore();
  const preferences = usePreferencesStore();

  const selected = computed(() => resources.selectedItem);
  const sourcePreviewBlocks = computed(() => {
    const item = selected.value;
    if (!item) return [preferences.t("resourceSourceTextMissing")];
    return toReadableBlocks(sourcePreviewText(item), preferences.t("resourceSourceTextMissing"));
  });
  const relatedResources = computed(() => (selected.value ? getResourceRelations(resources.items, selected.value, 4) : []));
  const duplicateRelations = computed(() => relatedResources.value.filter((relation) => relation.duplicate));

  function selectResource(id: string): void {
    resources.select(id);
  }

  return {
    duplicateRelations,
    relatedResources,
    selected,
    selectResource,
    sourcePreviewBlocks
  };
}
