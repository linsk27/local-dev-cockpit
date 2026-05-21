<template>
  <Teleport to="body">
    <div ref="overlayRef" class="welcome-overlay" role="presentation">
      <div class="welcome-spotlight" :style="spotlightStyle" aria-hidden="true"></div>

      <section
        ref="modalRef"
        class="welcome-modal"
        :class="`placement-${placement}`"
        :style="modalStyle"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <button class="icon-button welcome-close" type="button" :title="preferences.t('welcomeSecondaryAction')" @click="$emit('dismiss')">
          <X :size="16" />
        </button>

        <div
          class="welcome-tour-art"
          :class="`step-${stepIndex}`"
          aria-hidden="true"
          @pointermove="handlePointerMove"
          @pointerleave="resetPointerTilt"
        >
          <div class="firework-field">
            <span v-for="particle in particles" :key="particle.id" class="firework-dot" :style="particle.style"></span>
          </div>
          <span class="pilot-grid-floor"></span>
          <span class="pilot-halo halo-one"></span>
          <span class="pilot-halo halo-two"></span>
          <span class="pilot-hud hud-left"></span>
          <span class="pilot-hud hud-right"></span>
          <div class="pilot-card-3d" :class="`pilot-step-${stepIndex}`">
            <span class="pilot-depth-layer layer-one"></span>
            <span class="pilot-depth-layer layer-two"></span>
            <div class="pilot-card-top">
              <component :is="activeStep.icon" :size="22" />
              <span>Dev Pilot</span>
            </div>
            <div class="pilot-orbit">
              <span class="orbit-ring ring-a"></span>
              <span class="orbit-ring ring-b"></span>
              <span class="orbit-sweep"></span>
              <span class="orbit-node node-one"></span>
              <span class="orbit-node node-two"></span>
              <span class="orbit-node node-three"></span>
            </div>
            <div class="pilot-lines">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <div class="welcome-copy">
          <p class="step-counter">{{ preferences.t("welcomeStepCounter", { current: stepIndex + 1, total: steps.length }) }}</p>
          <h2 :id="titleId">{{ preferences.t(activeStep.titleKey) }}</h2>
          <p>{{ preferences.t(activeStep.bodyKey) }}</p>
        </div>

        <form v-if="isLastStep" class="welcome-root-form" @submit.prevent="submit">
          <label>
            {{ preferences.t("rootPath") }}
            <input
              :value="rootPath"
              :placeholder="preferences.t('rootPlaceholder')"
              @input="$emit('update:rootPath', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <button class="text-button welcome-root-picker" type="button" :disabled="pickingRoot || submitting" @click="$emit('pickRoot')">
            <FolderOpen :size="16" />
            {{ pickingRoot ? preferences.t("choosingRootFolder") : preferences.t("chooseRootFolder") }}
          </button>
          <p>{{ preferences.t("welcomePrivacy") }}</p>
        </form>

        <div class="welcome-actions">
          <button class="text-button" type="button" @click="stepIndex === 0 ? $emit('dismiss') : previousStep()">
            <ChevronLeft v-if="stepIndex > 0" :size="16" />
            {{ stepIndex === 0 ? preferences.t("welcomeSkip") : preferences.t("welcomeBack") }}
          </button>
          <button v-if="!isLastStep" class="primary-button" type="button" @click="nextStep">
            {{ preferences.t("welcomeNext") }}
            <ChevronRight :size="16" />
          </button>
          <button v-else class="primary-button" type="button" :disabled="!canSubmit || submitting" @click="submit">
            <Loader2 v-if="submitting" :size="16" class="spin-icon" />
            <Rocket v-else :size="16" />
            {{ preferences.t("welcomePrimaryAction") }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component, type CSSProperties } from "vue";
import { Bot, ChevronLeft, ChevronRight, FolderOpen, Loader2, Rocket, SquareTerminal, X } from "lucide-vue-next";
import { loadGsap } from "../../shared/animation/useGsap";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";

const props = defineProps<{
  rootPath: string;
  submitting: boolean;
  pickingRoot: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
  pickRoot: [];
  submit: [];
  "update:rootPath": [value: string];
}>();

interface WelcomeStep {
  titleKey: MessageKey;
  bodyKey: MessageKey;
  selector: string;
  icon: Component;
}

const preferences = usePreferencesStore();
const overlayRef = ref<HTMLElement | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const stepIndex = ref(0);
const titleId = `welcome-title-${Math.random().toString(36).slice(2)}`;
const modalStyle = ref<CSSProperties>({});
const spotlightStyle = ref<CSSProperties>({});
const placement = ref<"right" | "left" | "top" | "bottom" | "center">("center");
const steps: WelcomeStep[] = [
  {
    titleKey: "welcomeStepWorkspaceTitle",
    bodyKey: "welcomeStepWorkspaceBody",
    selector: ".onboarding-root-form",
    icon: markRaw(FolderOpen)
  },
  {
    titleKey: "welcomeStepCommandsTitle",
    bodyKey: "welcomeStepCommandsBody",
    selector: ".onboarding-step:nth-child(2)",
    icon: markRaw(SquareTerminal)
  },
  {
    titleKey: "welcomeStepContextTitle",
    bodyKey: "welcomeStepContextBody",
    selector: ".onboarding-step:nth-child(3)",
    icon: markRaw(Bot)
  }
];
const particles = Array.from({ length: 30 }, (_, index) => ({
  id: index,
  style: {
    "--angle": `${index * 12}deg`,
    "--distance": `${54 + (index % 5) * 12}px`,
    "--delay": `${(index % 10) * 34}ms`
  }
}));
const activeStep = computed(() => steps[stepIndex.value] ?? steps[0]);
const isLastStep = computed(() => stepIndex.value === steps.length - 1);
const canSubmit = computed(() => props.rootPath.trim().length > 0);
const reduceMotion = computed(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
let animationRunId = 0;

function nextStep(): void {
  stepIndex.value = Math.min(stepIndex.value + 1, steps.length - 1);
}

function previousStep(): void {
  stepIndex.value = Math.max(stepIndex.value - 1, 0);
}

function submit(): void {
  if (canSubmit.value && !props.submitting) emit("submit");
}

async function runStepAnimation(): Promise<void> {
  if (reduceMotion.value) return;
  const currentRunId = ++animationRunId;
  await nextTick();
  const modal = modalRef.value;
  if (!modal) return;
  const gsap = await loadGsap();
  if (currentRunId !== animationRunId || !modalRef.value) return;

  const card = modal.querySelector(".pilot-card-3d");
  const dots = modal.querySelectorAll(".firework-dot");
  const hud = modal.querySelectorAll(".pilot-hud, .pilot-halo, .pilot-grid-floor");
  const copy = modal.querySelectorAll(".welcome-copy > *, .welcome-root-form, .welcome-actions");

  gsap.killTweensOf([card, dots, hud, copy]);
  gsap.fromTo(
    card,
    { "--pilot-y": "14px", "--pilot-scale": 0.93, autoAlpha: 0 },
    { "--pilot-y": "0px", "--pilot-scale": 1, autoAlpha: 1, duration: 0.58, ease: "power3.out" }
  );
  gsap.fromTo(
    hud,
    { autoAlpha: 0, scale: 0.88 },
    { autoAlpha: 1, scale: 1, duration: 0.44, stagger: 0.035, ease: "power2.out" }
  );
  gsap.fromTo(
    dots,
    { autoAlpha: 0, scale: 0 },
    { autoAlpha: 1, scale: 1, duration: 0.22, stagger: 0.012, yoyo: true, repeat: 1, ease: "power2.out" }
  );
  gsap.fromTo(
    copy,
    { y: 8, autoAlpha: 0 },
    { y: 0, autoAlpha: 1, duration: 0.34, stagger: 0.035, ease: "power2.out" }
  );
}

function handlePointerMove(event: PointerEvent): void {
  if (reduceMotion.value) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  target.style.setProperty("--pilot-tilt-y", `${x * 18}deg`);
  target.style.setProperty("--pilot-tilt-x", `${-y * 12}deg`);
}

function resetPointerTilt(event?: PointerEvent): void {
  const target = (event?.currentTarget as HTMLElement | undefined) ?? modalRef.value?.querySelector<HTMLElement>(".welcome-tour-art");
  target?.style.setProperty("--pilot-tilt-y", "-13deg");
  target?.style.setProperty("--pilot-tilt-x", "9deg");
}

async function updateGuideLayout(): Promise<void> {
  await nextTick();
  const target = document.querySelector<HTMLElement>(activeStep.value.selector);
  const modal = modalRef.value;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  if (!target || !modal) {
    placement.value = "center";
    modalStyle.value = {
      left: `${Math.max(16, viewportWidth / 2 - 190)}px`,
      top: `${Math.max(16, viewportHeight / 2 - 160)}px`
    };
    spotlightStyle.value = {};
    return;
  }

  const gap = 18;
  const pad = 10;
  const targetRect = target.getBoundingClientRect();
  const modalWidth = Math.min(390, viewportWidth - 28);
  const modalHeight = Math.min(320, viewportHeight - 28);
  const spot = {
    left: Math.max(8, targetRect.left - pad),
    top: Math.max(8, targetRect.top - pad),
    width: Math.min(viewportWidth - 16, targetRect.width + pad * 2),
    height: Math.min(viewportHeight - 16, targetRect.height + pad * 2)
  };
  spotlightStyle.value = {
    left: `${spot.left}px`,
    top: `${spot.top}px`,
    width: `${spot.width}px`,
    height: `${spot.height}px`
  };
  overlayRef.value?.style.setProperty("--spot-x", `${spot.left + spot.width / 2}px`);
  overlayRef.value?.style.setProperty("--spot-y", `${spot.top + spot.height / 2}px`);

  let left = targetRect.right + gap;
  let top = targetRect.top + targetRect.height / 2 - modalHeight / 2;
  placement.value = "right";

  if (left + modalWidth > viewportWidth - 14) {
    left = targetRect.left - modalWidth - gap;
    placement.value = "left";
  }
  if (left < 14) {
    left = targetRect.left + targetRect.width / 2 - modalWidth / 2;
    top = targetRect.bottom + gap;
    placement.value = "bottom";
  }
  if (top + modalHeight > viewportHeight - 14) top = viewportHeight - modalHeight - 14;
  if (top < 14) top = 14;
  if (left + modalWidth > viewportWidth - 14) left = viewportWidth - modalWidth - 14;
  if (left < 14) left = 14;

  modalStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${Math.round(modalWidth)}px`
  };
}

watch(stepIndex, () => {
  void updateGuideLayout();
  void runStepAnimation();
});

onMounted(() => {
  void updateGuideLayout();
  window.addEventListener("resize", updateGuideLayout);
  if (!reduceMotion.value && modalRef.value) {
    void loadGsap().then((gsap) => {
      if (!modalRef.value) return;
      gsap.fromTo(
        modalRef.value,
        { opacity: 0, y: 10, scale: 0.96 },
        { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "power3.out" }
      );
    });
  }
  void runStepAnimation();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updateGuideLayout);
});
</script>
