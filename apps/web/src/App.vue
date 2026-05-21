<template>
  <div ref="shellRef" class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-main">
          <div class="brand-mark">
            <DevPilotMark :title="preferences.t('brandNickname')" />
          </div>
          <div class="brand-copy">
            <strong>Dev Cockpit</strong>
            <span>{{ preferences.t("brandNickname") }}</span>
          </div>
        </div>
        <div class="brand-actions">
          <button
            v-if="updates.hasUpdate"
            class="icon-button update-badge"
            :title="updateTitle"
            type="button"
            @click="openUpdate"
          >
            <Download :size="16" />
          </button>
          <button class="icon-button sidebar-toggle" :title="toggleTitle" type="button" @click="toggleSidebar">
            <PanelLeftOpen v-if="sidebarCollapsed" :size="17" />
            <PanelLeftClose v-else :size="17" />
          </button>
        </div>
      </div>
      <nav class="nav">
        <RouterLink to="/" class="nav-link">
          <LayoutDashboard :size="17" />
          <span class="nav-label">{{ preferences.t("navProjects") }}</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-link">
          <Settings :size="17" />
          <span class="nav-label">{{ preferences.t("navSettings") }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <ResourceUsagePanel />
        <div class="sidebar-footer">
          <span>{{ preferences.t("localOnly") }}</span>
          <span>{{ preferences.t("noCloudSync") }}</span>
        </div>
      </div>
    </aside>
    <main class="main-surface">
      <RouterView />
    </main>
  </div>
  <ToastStack />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Download, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-vue-next";
import { usePreferencesStore } from "./stores/preferences";
import { useUpdatesStore } from "./stores/updates";
import { animateSubtleEntrance, useGsapScope } from "./shared/animation/useGsap";
import DevPilotMark from "./shared/ui/DevPilotMark.vue";
import ResourceUsagePanel from "./shared/ui/ResourceUsagePanel.vue";
import ToastStack from "./shared/ui/ToastStack.vue";

const SIDEBAR_KEY = "dev-cockpit:sidebar-collapsed";
const preferences = usePreferencesStore();
const updates = useUpdatesStore();
const shellRef = ref<HTMLElement | null>(null);
const sidebarCollapsed = ref(readSidebarCollapsed());
const toggleTitle = computed(() =>
  sidebarCollapsed.value ? preferences.t("expandSidebar") : preferences.t("collapseSidebar")
);
const updateTitle = computed(() =>
  updates.result?.latestVersion
    ? preferences.t("updateAvailableTitle", { version: updates.result.latestVersion })
    : preferences.t("updateAvailable")
);

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed.value));
}

function openUpdate(): void {
  const target = updates.result?.installerAsset?.downloadUrl ?? updates.result?.releaseUrl;
  if (target) window.open(target, "_blank", "noopener");
}

function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}

useGsapScope(shellRef, (element, gsap) => {
  animateSubtleEntrance(gsap, element.querySelectorAll(".brand, .nav-link, .resource-usage, .main-surface"), {
    x: -8,
    y: 0,
    duration: 0.34,
    stagger: 0.045
  });
});

onMounted(() => {
  void updates.check({ silent: true });
});
</script>
