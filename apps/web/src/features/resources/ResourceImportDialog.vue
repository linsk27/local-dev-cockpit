<template>
  <div class="resource-modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="resource-modal resource-file-modal surface" role="dialog" aria-modal="true" :aria-label="dialogText.importTitle">
      <header class="resource-modal-head">
        <div>
          <span>{{ dialogText.importEyebrow }}</span>
          <strong>{{ dialogText.importTitle }}</strong>
        </div>
        <button class="icon-button" type="button" :title="dialogText.close" @click="$emit('close')">
          <X :size="16" />
        </button>
      </header>
      <div class="resource-modal-body">
        <label class="resource-file-drop">
          <Upload :size="18" />
          <strong>{{ dialogText.chooseJson }}</strong>
          <span>{{ dialogText.importDescription }}</span>
          <input type="file" accept="application/json,.json" :disabled="importExporting" @change="emitFile" />
        </label>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Upload, X } from "lucide-vue-next";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{
  importExporting: boolean;
}>();

const emit = defineEmits<{
  close: [];
  importFile: [file: File];
}>();

const preferences = usePreferencesStore();
const dialogText = computed(() => {
  const zh = preferences.locale !== "en-US";
  return {
    importEyebrow: zh ? "JSON 导入" : "JSON import",
    importTitle: zh ? "导入资源库" : "Import resources",
    importDescription: zh ? "支持 Dev Cockpit 导出的 JSON，导入时会跳过重复资源。" : "Use a Dev Cockpit JSON export. Duplicate resources are skipped.",
    chooseJson: zh ? "选择 JSON 文件" : "Choose a JSON file",
    close: zh ? "关闭" : "Close"
  };
});

function emitFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) emit("importFile", file);
}
</script>
