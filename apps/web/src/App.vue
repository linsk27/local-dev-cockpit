<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">DC</div>
        <div>
          <strong>Dev Cockpit</strong>
          <span>Local workspace</span>
        </div>
      </div>
      <nav class="nav">
        <RouterLink to="/" class="nav-link">
          <LayoutDashboard :size="17" />
          Projects
        </RouterLink>
        <RouterLink to="/settings" class="nav-link">
          <Settings :size="17" />
          Settings
        </RouterLink>
      </nav>
      <div class="sidebar-footer">
        <span>Local only</span>
        <span>No cloud sync</span>
      </div>
    </aside>
    <main class="main-surface">
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { LayoutDashboard, Settings } from "lucide-vue-next";
</script>

