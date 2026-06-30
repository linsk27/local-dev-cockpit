<template>
  <header class="resource-capture surface">
    <div class="resource-capture-title">
      <h1>{{ preferences.t("resourcesTitle") }}</h1>
      <span>{{ count }}</span>
    </div>
    <div class="resource-capture-actions">
      <button class="primary-button" type="button" :disabled="previewing" @click="$emit('submit')">
        <Plus :size="15" />
        {{ previewing ? preferences.t("resourceParsing") : addResourceLabel }}
      </button>
      <button class="text-button" type="button" :disabled="importExporting" @click="$emit('import')">
        <Upload :size="14" />
        {{ preferences.t("resourceImport") }}
      </button>
      <button class="text-button" type="button" :disabled="importExporting || count === 0" @click="$emit('export')">
        <Download :size="14" />
        {{ preferences.t("resourceExport") }}
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Download, Plus, Upload } from "lucide-vue-next";
import { computed } from "vue";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{
  count: number;
  importExporting: boolean;
  previewing: boolean;
}>();

const emit = defineEmits<{
  export: [];
  import: [];
  submit: [];
}>();

const preferences = usePreferencesStore();
const addResourceLabel = computed(() => (preferences.locale === "en-US" ? "Add resource" : "新增资源"));
</script>
