<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">DC</div>
        <div class="brand-copy">
          <strong>Dev Cockpit</strong>
          <span>{{ preferences.t("appSubtitle") }}</span>
        </div>
      </div>
      <button class="icon-button sidebar-toggle" :title="toggleTitle" @click="toggleSidebar">
        <PanelLeftOpen v-if="sidebarCollapsed" :size="17" />
        <PanelLeftClose v-else :size="17" />
      </button>
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
      <div class="sidebar-footer">
        <span>{{ preferences.t("localOnly") }}</span>
        <span>{{ preferences.t("noCloudSync") }}</span>
      </div>
    </aside>
    <main class="main-surface">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-vue-next";
import { usePreferencesStore } from "./stores/preferences";

const SIDEBAR_KEY = "dev-cockpit:sidebar-collapsed";
const preferences = usePreferencesStore();
const sidebarCollapsed = ref(readSidebarCollapsed());
const toggleTitle = computed(() =>
  sidebarCollapsed.value ? preferences.t("expandSidebar") : preferences.t("collapseSidebar")
);

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed.value));
}

function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}
</script>
