import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { usePreferencesStore } from "./stores/preferences";
import "./styles.css";

const pinia = createPinia();
const app = createApp(App);

app.use(pinia).use(router);
usePreferencesStore(pinia).init();
app.mount("#app");
