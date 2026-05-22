import { createRouter, createWebHistory } from "vue-router";
import ApiLensPage from "./features/api-lens/ApiLensPage.vue";
import ProjectDashboard from "./features/projects/ProjectDashboard.vue";
import SettingsPage from "./features/settings/SettingsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ProjectDashboard },
    { path: "/api-lens", component: ApiLensPage },
    { path: "/settings", component: SettingsPage }
  ]
});
