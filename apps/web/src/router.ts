import { createRouter, createWebHistory } from "vue-router";
import ProjectDashboard from "./features/projects/ProjectDashboard.vue";
import ResourceRadarPage from "./features/resources/ResourceRadarPage.vue";
import AiSettingsPage from "./features/settings/AiSettingsPage.vue";
import SettingsPage from "./features/settings/SettingsPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: ProjectDashboard },
    { path: "/resources", component: ResourceRadarPage },
    { path: "/skills", redirect: "/resources" },
    { path: "/ai-settings", component: AiSettingsPage },
    { path: "/settings", component: SettingsPage },
    { path: "/:pathMatch(.*)*", redirect: "/" }
  ]
});
