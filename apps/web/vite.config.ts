import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/gsap")) return "gsap";
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  }
});
