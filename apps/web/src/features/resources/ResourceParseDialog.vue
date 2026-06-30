<template>
  <div class="resource-modal-backdrop" role="presentation" @click.self="$emit('close')">
    <section class="resource-modal resource-parse-modal surface" role="dialog" aria-modal="true" :aria-label="dialogText.parseTitle">
      <header class="resource-modal-head">
        <div>
          <span>{{ dialogText.parseEyebrow }}</span>
          <strong>{{ dialogText.parseTitle }}</strong>
        </div>
        <button class="icon-button" type="button" :title="dialogText.close" @click="$emit('close')">
          <X :size="16" />
        </button>
      </header>

      <div class="resource-modal-body resource-parse-layout">
        <form class="resource-parse-form" @submit.prevent="$emit('submit')">
          <label class="resource-modal-field">
            <span>{{ dialogText.sourceUrl }}</span>
            <input
              :value="sourceUrl"
              type="url"
              :placeholder="preferences.t('resourceCapturePlaceholder')"
              @input="emitSourceUrl"
            />
          </label>
          <label class="resource-modal-field">
            <span>{{ dialogText.sourceText }}</span>
            <textarea
              :value="sourceText"
              rows="8"
              :placeholder="preferences.t('resourceTextPlaceholder')"
              @input="emitSourceText"
            />
          </label>
          <p class="resource-modal-hint">{{ dialogText.parseHint }}</p>
          <p v-if="error" class="resource-modal-error">{{ error }}</p>
          <div class="resource-modal-actions">
            <button class="text-button" type="button" :disabled="previewing || saving" @click="$emit('close')">
              {{ preferences.t("resourceCancel") }}
            </button>
            <button class="primary-button" type="submit" :disabled="previewing || !canSubmit">
              <Sparkles :size="15" />
              {{ previewing ? preferences.t("resourceParsing") : dialogText.startParse }}
            </button>
          </div>
        </form>

        <ResourcePreviewCard
          v-if="previewItem"
          class="resource-preview-card"
          :item="previewItem"
          :saving="saving"
          @cancel="$emit('cancelPreview')"
          @commit="$emit('commitPreview')"
        />
        <aside v-else class="resource-preview-placeholder">
          <span>{{ dialogText.previewEyebrow }}</span>
          <strong>{{ dialogText.previewTitle }}</strong>
          <p>{{ dialogText.previewDescription }}</p>
        </aside>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Sparkles, X } from "lucide-vue-next";
import type { RadarItem } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import ResourcePreviewCard from "./ResourcePreviewCard.vue";

defineProps<{
  canSubmit: boolean;
  error: string;
  previewItem?: RadarItem;
  previewing: boolean;
  saving: boolean;
  sourceText: string;
  sourceUrl: string;
}>();

const emit = defineEmits<{
  cancelPreview: [];
  close: [];
  commitPreview: [];
  submit: [];
  "update:sourceText": [value: string];
  "update:sourceUrl": [value: string];
}>();

const preferences = usePreferencesStore();
const dialogText = computed(() => {
  const zh = preferences.locale !== "en-US";
  return {
    parseEyebrow: zh ? "资源收集" : "Resource intake",
    parseTitle: zh ? "解析新资源" : "Parse a new resource",
    parseHint: zh
      ? "链接适合 GitHub、Demo、文章；文本适合 README、视频号笔记、Prompt 或 SKILL.md。"
      : "Use a link for GitHub, demos, and articles; use text for README snippets, notes, prompts, or SKILL.md.",
    sourceUrl: zh ? "链接" : "Link",
    sourceText: zh ? "说明文本（可选）" : "Context text (optional)",
    startParse: zh ? "开始解析" : "Start parsing",
    previewEyebrow: zh ? "等待解析" : "Waiting for parse",
    previewTitle: zh ? "解析结果会在这里确认" : "Review the parsed card here",
    previewDescription: zh
      ? "确认后才会写入资源库。解析失败时会保留本地规则生成的卡片。"
      : "Nothing is saved until you confirm. If AI times out, the local-rule card is still kept for review.",
    close: zh ? "关闭" : "Close"
  };
});

function emitSourceUrl(event: Event): void {
  const target = event.target as HTMLInputElement;
  emit("update:sourceUrl", target.value);
}

function emitSourceText(event: Event): void {
  const target = event.target as HTMLTextAreaElement;
  emit("update:sourceText", target.value);
}
</script>
