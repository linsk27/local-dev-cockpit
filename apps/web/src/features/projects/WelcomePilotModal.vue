<template>
  <Teleport to="body">
    <div class="welcome-overlay" role="presentation">
      <section ref="modalRef" class="welcome-modal" role="dialog" aria-modal="true" :aria-labelledby="titleId">
        <button class="icon-button welcome-close" type="button" :title="preferences.t('welcomeSecondaryAction')" @click="$emit('dismiss')">
          <X :size="16" />
        </button>

        <div class="welcome-stage" aria-hidden="true">
          <DevPilotMark class="welcome-mark" />
          <div class="pilot-radar">
            <span class="radar-ring ring-one"></span>
            <span class="radar-ring ring-two"></span>
            <span class="radar-sweep"></span>
            <span class="radar-node node-a"></span>
            <span class="radar-node node-b"></span>
            <span class="radar-node node-c"></span>
          </div>
          <div class="pilot-console">
            <span>workspace.scan()</span>
            <span>git.status: clean</span>
            <span>ports.sync: ready</span>
          </div>
        </div>

        <div class="welcome-copy">
          <p class="eyebrow">{{ preferences.t("welcomeEyebrow") }}</p>
          <h2 :id="titleId">{{ preferences.t("welcomeTitle") }}</h2>
          <p>{{ preferences.t("welcomeSubtitle") }}</p>
        </div>

        <div class="welcome-features">
          <div v-for="feature in features" :key="feature.labelKey" class="welcome-feature">
            <component :is="feature.icon" :size="17" />
            <span>{{ preferences.t(feature.labelKey) }}</span>
          </div>
        </div>

        <form class="welcome-root-form" @submit.prevent="submit">
          <label>
            {{ preferences.t("rootPath") }}
            <input
              :value="rootPath"
              :placeholder="preferences.t('rootPlaceholder')"
              @input="$emit('update:rootPath', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <button class="primary-button" type="submit" :disabled="!canSubmit || submitting">
            <Loader2 v-if="submitting" :size="16" class="spin-icon" />
            <Rocket v-else :size="16" />
            {{ preferences.t("welcomePrimaryAction") }}
          </button>
        </form>

        <p class="welcome-privacy">{{ preferences.t("welcomePrivacy") }}</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, markRaw, onMounted, ref, type Component } from "vue";
import { Bot, FolderSearch, GitBranch, Loader2, Radar, Rocket, SquareTerminal, X } from "lucide-vue-next";
import { animate, stagger } from "animejs";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import DevPilotMark from "../../shared/ui/DevPilotMark.vue";

const props = defineProps<{
  rootPath: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
  submit: [];
  "update:rootPath": [value: string];
}>();

const preferences = usePreferencesStore();
const modalRef = ref<HTMLElement | null>(null);
const titleId = `welcome-title-${Math.random().toString(36).slice(2)}`;
const canSubmit = computed(() => props.rootPath.trim().length > 0);
const features: Array<{ labelKey: MessageKey; icon: Component }> = [
  { labelKey: "welcomeFeatureScan", icon: markRaw(FolderSearch) },
  { labelKey: "welcomeFeatureRun", icon: markRaw(SquareTerminal) },
  { labelKey: "welcomeFeatureGit", icon: markRaw(GitBranch) },
  { labelKey: "welcomeFeatureAi", icon: markRaw(Bot) },
  { labelKey: "welcomeFeatureLocal", icon: markRaw(Radar) }
];

function submit(): void {
  if (canSubmit.value && !props.submitting) emit("submit");
}

onMounted(() => {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !modalRef.value) return;
  animate(modalRef.value, {
    opacity: [0, 1],
    translateY: [18, 0],
    scale: [0.985, 1],
    duration: 520,
    easing: "out(3)"
  });
  animate(".welcome-feature", {
    opacity: [0, 1],
    translateY: [12, 0],
    delay: stagger(70, { start: 180 }),
    duration: 420,
    easing: "out(3)"
  });
  animate(".radar-node", {
    scale: [0.65, 1.12, 1],
    opacity: [0, 1],
    delay: stagger(120, { start: 260 }),
    duration: 620,
    easing: "out(4)"
  });
  animate(".pilot-console span", {
    opacity: [0, 1],
    translateX: [-8, 0],
    delay: stagger(95, { start: 360 }),
    duration: 360,
    easing: "out(3)"
  });
});
</script>
