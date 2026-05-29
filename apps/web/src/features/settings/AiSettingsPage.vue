<template>
  <section ref="settingsRef" class="workspace settings-page ai-settings-page">
    <section class="surface ai-settings-panel">
      <header class="ai-settings-hero">
        <div>
          <span>{{ preferences.t("aiSettingsTitle") }}</span>
          <h1>{{ statusTitle }}</h1>
        </div>
        <span class="resource-config-state" :data-state="resources.aiConfig?.hasApiKey ? 'ready' : 'missing'">
          {{
            resources.aiConfig?.hasApiKey
              ? preferences.t("aiConfiguredState", { provider: providerLabel(resources.aiConfig.providerId) })
              : preferences.t("aiMissingState")
          }}
        </span>
      </header>

      <form class="ai-settings-form" @submit.prevent="saveAiConfig">
        <div class="ai-settings-grid">
          <label>
            <span>{{ preferences.t("aiProvider") }}</span>
            <div class="ai-provider-picker" @focusout="handleProviderFocusOut" @keydown.esc.stop="providerMenuOpen = false">
              <button
                class="ai-provider-trigger"
                type="button"
                aria-haspopup="listbox"
                :aria-expanded="providerMenuOpen"
                @click="providerMenuOpen = !providerMenuOpen"
              >
                <span>{{ providerLabel(aiProviderId) }}</span>
                <ChevronDown :size="16" />
              </button>
              <div v-if="providerMenuOpen" class="ai-provider-menu" role="listbox">
                <button
                  v-for="provider in providerOptions"
                  :key="provider.id"
                  class="ai-provider-option"
                  :class="{ active: provider.id === aiProviderId }"
                  type="button"
                  role="option"
                  :aria-selected="provider.id === aiProviderId"
                  @click="selectProvider(provider.id)"
                >
                  <span>{{ provider.label }}</span>
                  <small>{{ provider.model }}</small>
                  <Check v-if="provider.id === aiProviderId" :size="15" />
                </button>
              </div>
            </div>
          </label>
          <label>
            <span>Base URL</span>
            <input v-model="aiBaseUrl" placeholder="https://code.rayinai.com/v1" />
          </label>
          <label>
            <span>Model</span>
            <input v-model="aiModel" placeholder="gpt-5.4" />
          </label>
          <label>
            <span>API Key</span>
            <input v-model="aiApiKey" type="password" :placeholder="preferences.t('aiKeyPlaceholder')" autocomplete="off" />
          </label>
        </div>

        <div v-if="resources.aiTestResult" class="ai-test-result" :data-state="resources.aiTestResult.ok ? 'ready' : 'missing'">
          <CheckCircle2 v-if="resources.aiTestResult.ok" :size="15" />
          <CircleAlert v-else :size="15" />
          <span>
            {{
              resources.aiTestResult.ok
                ? preferences.t("aiConnectionSuccess", {
                    model: resources.aiTestResult.model,
                    latency: resources.aiTestResult.latencyMs
                  })
                : resources.aiTestResult.error
            }}
          </span>
        </div>

        <div class="ai-settings-actions">
          <button class="text-button" type="button" :disabled="resources.aiConfigSaving || resources.aiConfigTesting" @click="clearAiKey">
            {{ preferences.t("aiClearKey") }}
          </button>
          <button class="text-button" type="button" :disabled="resources.aiConfigTesting" @click="testAiConfig">
            <PlugZap :size="15" />
            {{ resources.aiConfigTesting ? preferences.t("aiTesting") : preferences.t("aiTestConnection") }}
          </button>
          <button class="primary-button" type="submit" :disabled="resources.aiConfigSaving">
            <Save :size="15" />
            {{ resources.aiConfigSaving ? preferences.t("aiSaving") : preferences.t("aiSaveConfig") }}
          </button>
        </div>
      </form>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Check, CheckCircle2, ChevronDown, CircleAlert, PlugZap, Save } from "lucide-vue-next";
import { useResourcesStore } from "../../stores/resources";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { animateSubtleEntrance, useGsapScope } from "../../shared/animation/useGsap";
import type { AiProviderId } from "../../api";

const resources = useResourcesStore();
const notifications = useNotificationsStore();
const preferences = usePreferencesStore();
const settingsRef = ref<HTMLElement | null>(null);
const aiProviderId = ref<AiProviderId>("rayinai");
const aiBaseUrl = ref("");
const aiModel = ref("");
const aiApiKey = ref("");
const providerMenuOpen = ref(false);

const fallbackProviders: Record<AiProviderId, { label: string; baseUrl: string; model: string }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  rayinai: { label: "RayinAI / Custom Gateway", baseUrl: "https://code.rayinai.com/v1", model: "gpt-5.4" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  siliconflow: { label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  ollama: { label: "Ollama Local", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
  custom: { label: "Custom OpenAI-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
};

const providerOptions = computed(() =>
  (Object.entries(resources.aiProviders ?? fallbackProviders) as Array<[AiProviderId, { label: string; baseUrl: string; model: string }]>).map(
    ([id, preset]) => ({ id, ...preset })
  )
);
const statusTitle = computed(() =>
  resources.aiConfig?.hasApiKey ? preferences.t("aiSettingsConfigured") : preferences.t("aiSettingsMissing")
);

onMounted(() => {
  void loadAiConfig();
});

useGsapScope(settingsRef, (element, gsap) => {
  animateSubtleEntrance(gsap, element.querySelectorAll(".ai-settings-panel"), {
    y: 10,
    duration: 0.26
  });
});

async function loadAiConfig(): Promise<void> {
  const config = await resources.loadAiConfig();
  if (!config) {
    applyProviderPreset();
    return;
  }
  aiProviderId.value = config.providerId;
  aiBaseUrl.value = config.baseUrl;
  aiModel.value = config.model;
  aiApiKey.value = "";
}

function applyProviderPreset(): void {
  const preset = (resources.aiProviders ?? fallbackProviders)[aiProviderId.value];
  if (!preset) return;
  aiBaseUrl.value = preset.baseUrl;
  aiModel.value = preset.model;
}

function selectProvider(providerId: AiProviderId): void {
  aiProviderId.value = providerId;
  providerMenuOpen.value = false;
  applyProviderPreset();
}

function handleProviderFocusOut(event: FocusEvent): void {
  const current = event.currentTarget;
  const next = event.relatedTarget;
  if (!(current instanceof HTMLElement) || !(next instanceof Node) || !current.contains(next)) {
    providerMenuOpen.value = false;
  }
}

async function saveAiConfig(): Promise<void> {
  const config = await resources.saveAiConfig({
    providerId: aiProviderId.value,
    baseUrl: aiBaseUrl.value,
    model: aiModel.value,
    apiKey: aiApiKey.value
  });
  if (!config) return;
  syncConfig(config);
  notifications.success(preferences.t("aiConfigSavedNotice"));
}

async function testAiConfig(): Promise<void> {
  const result = await resources.testAiConfig({
    providerId: aiProviderId.value,
    baseUrl: aiBaseUrl.value,
    model: aiModel.value,
    apiKey: aiApiKey.value
  });
  if (!result) return;
  if (result.ok) notifications.success(preferences.t("aiConnectionSuccessNotice"));
}

async function clearAiKey(): Promise<void> {
  const config = await resources.saveAiConfig({
    providerId: aiProviderId.value,
    baseUrl: aiBaseUrl.value,
    model: aiModel.value,
    clearApiKey: true
  });
  if (!config) return;
  syncConfig(config);
  notifications.success(preferences.t("aiKeyClearedNotice"));
}

function syncConfig(config: { providerId: AiProviderId; baseUrl: string; model: string }): void {
  aiProviderId.value = config.providerId;
  aiBaseUrl.value = config.baseUrl;
  aiModel.value = config.model;
  aiApiKey.value = "";
}

function providerLabel(providerId: AiProviderId): string {
  return (resources.aiProviders ?? fallbackProviders)[providerId]?.label ?? providerId;
}
</script>
