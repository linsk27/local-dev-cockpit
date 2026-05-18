<template>
  <section class="workspace settings-page">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">SETTINGS</p>
        <h1>Project roots</h1>
      </div>
    </header>
    <section class="surface settings-panel">
      <label>
        Root path
        <input v-model="rootPath" placeholder="D:\\个人" />
      </label>
      <button class="primary-button" @click="submitRoot">
        <Plus :size="16" />
        Add root
      </button>
      <p v-if="message" class="settings-message">{{ message }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Plus } from "lucide-vue-next";
import { addRoot } from "../../api";

const rootPath = ref("D:\\个人");
const message = ref("");

async function submitRoot() {
  await addRoot(rootPath.value);
  message.value = "Root saved. Return to Projects and refresh.";
}
</script>

