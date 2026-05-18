<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">DC</div>
        <div>
          <strong>Dev Cockpit</strong>
          <span>{{ preferences.t("appSubtitle") }}</span>
        </div>
      </div>
      <nav class="nav">
        <RouterLink to="/" class="nav-link">
          <LayoutDashboard :size="17" />
          {{ preferences.t("navProjects") }}
        </RouterLink>
        <RouterLink to="/settings" class="nav-link">
          <Settings :size="17" />
          {{ preferences.t("navSettings") }}
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
import { LayoutDashboard, Settings } from "lucide-vue-next";
import { usePreferencesStore } from "./stores/preferences";

const preferences = usePreferencesStore();
</script>
