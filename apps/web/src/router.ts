import { createRouter, createWebHistory } from "vue-router";
import ProjectDashboard from "./features/projects/ProjectDashboard.vue";
import SettingsPage from "./features/settings/SettingsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ProjectDashboard },
    { path: "/settings", component: SettingsPage }
  ]
});

