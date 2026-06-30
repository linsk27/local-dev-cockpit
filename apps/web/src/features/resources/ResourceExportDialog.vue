<template>
  <div class="resource-modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="resource-modal resource-export-modal surface" role="dialog" aria-modal="true" :aria-label="dialogText.exportTitle">
      <header class="resource-modal-head">
        <div>
          <span>{{ dialogText.exportEyebrow }}</span>
          <strong>{{ dialogText.exportTitle }}</strong>
        </div>
        <button class="icon-button" type="button" :title="dialogText.close" @click="$emit('close')">
          <X :size="16" />
        </button>
      </header>
      <div class="resource-modal-body">
        <div class="resource-export-choices">
          <button
            v-for="option in options"
            :key="option.mode"
            class="resource-export-choice"
            :class="{ active: exportMode === option.mode }"
            type="button"
            :disabled="option.count === 0"
            @click="$emit('update:exportMode', option.mode)"
          >
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
            <em>{{ option.count }}</em>
          </button>
        </div>

        <div v-if="exportMode === 'status' || exportMode === 'category'" class="resource-export-controls" @keydown.esc.stop="$emit('closePicker')">
          <div v-if="exportMode === 'status'" class="resource-modal-field">
            <span>{{ dialogText.status }}</span>
            <div class="resource-picker" :class="{ open: openPicker === 'status' }">
              <button
                class="resource-picker-trigger"
                type="button"
                aria-haspopup="listbox"
                :aria-expanded="openPicker === 'status'"
                @click="$emit('togglePicker', 'status')"
              >
                <span>{{ exportStatusLabel }}</span>
                <ChevronDown :size="15" />
              </button>
              <div v-if="openPicker === 'status'" class="resource-picker-menu" role="listbox">
                <button
                  v-for="status in statusOptions"
                  :key="status.value"
                  class="resource-picker-option"
                  :class="{ active: exportStatus === status.value }"
                  type="button"
                  role="option"
                  :aria-selected="exportStatus === status.value"
                  @click="$emit('setStatus', status.value)"
                >
                  <span>{{ status.label }}</span>
                  <Check v-if="exportStatus === status.value" :size="14" />
                </button>
              </div>
            </div>
          </div>
          <div v-if="exportMode === 'category'" class="resource-modal-field">
            <span>{{ dialogText.category }}</span>
            <div class="resource-picker" :class="{ open: openPicker === 'category' }">
              <button
                class="resource-picker-trigger"
                type="button"
                aria-haspopup="listbox"
                :aria-expanded="openPicker === 'category'"
                :disabled="categoryOptions.length === 0"
                @click="$emit('togglePicker', 'category')"
              >
                <span>{{ exportCategoryLabel }}</span>
                <ChevronDown :size="15" />
              </button>
              <div v-if="openPicker === 'category'" class="resource-picker-menu" role="listbox">
                <button
                  v-for="node in categoryOptions"
                  :key="node.value"
                  class="resource-picker-option"
                  :class="{ active: exportCategoryValue === node.value }"
                  type="button"
                  role="option"
                  :aria-selected="exportCategoryValue === node.value"
                  @click="$emit('setCategory', node.value)"
                >
                  <span>{{ node.label }}</span>
                  <Check v-if="exportCategoryValue === node.value" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="resource-modal-actions">
          <button class="text-button" type="button" @click="$emit('close')">{{ preferences.t("resourceCancel") }}</button>
          <button class="primary-button" type="button" :disabled="exportItemsCount === 0" @click="$emit('export')">
            <Download :size="15" />
            {{ dialogText.exportSelected(exportItemsCount) }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Check, ChevronDown, Download, X } from "lucide-vue-next";
import type { ResourceStatus } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import type {
  ResourceExportCategoryOption,
  ResourceExportMode,
  ResourceExportOption,
  ResourceExportPicker,
  ResourceExportStatusOption
} from "./resource-export-dialog";

defineProps<{
  categoryOptions: ResourceExportCategoryOption[];
  exportCategoryLabel: string;
  exportCategoryValue: string;
  exportItemsCount: number;
  exportMode: ResourceExportMode;
  exportStatus: ResourceStatus;
  exportStatusLabel: string;
  openPicker: ResourceExportPicker;
  options: ResourceExportOption[];
  statusOptions: ResourceExportStatusOption[];
}>();

defineEmits<{
  close: [];
  closePicker: [];
  export: [];
  setCategory: [value: string];
  setStatus: [value: ResourceStatus];
  togglePicker: [picker: Exclude<ResourceExportPicker, "">];
  "update:exportMode": [mode: ResourceExportMode];
}>();

const preferences = usePreferencesStore();
const dialogText = computed(() => {
  const zh = preferences.locale !== "en-US";
  return {
    exportEyebrow: zh ? "选择范围" : "Choose scope",
    exportTitle: zh ? "导出资源" : "Export resources",
    close: zh ? "关闭" : "Close",
    status: zh ? "状态" : "Status",
    category: zh ? "分类" : "Category",
    exportSelected: (count: number) => (zh ? `导出 ${count} 条` : `Export ${count}`)
  };
});
</script>
