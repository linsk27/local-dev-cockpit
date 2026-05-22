<template>
  <section class="api-lens-page">
    <div class="api-lens-toolbar">
      <div>
        <span class="eyebrow">{{ preferences.t("apiLensEyebrow") }}</span>
        <h1>{{ preferences.t("apiLensTitle") }}</h1>
      </div>
      <div class="api-lens-actions">
        <button class="text-button" type="button" @click="void store.refreshRequests()">
          <RefreshCw :size="15" />
          {{ preferences.t("apiLensRefresh") }}
        </button>
        <button class="text-button" type="button" :disabled="!store.selectedTarget" @click="void store.clearRequests()">
          <Trash2 :size="15" />
          {{ preferences.t("apiLensClear") }}
        </button>
      </div>
    </div>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <section class="api-lens-guide surface">
      <div class="api-lens-guide-copy">
        <span class="eyebrow">{{ preferences.t("apiLensGuideEyebrow") }}</span>
        <h2>{{ preferences.t("apiLensGuideTitle") }}</h2>
        <p>{{ preferences.t("apiLensGuideDescription") }}</p>
      </div>
      <div class="api-lens-guide-steps" aria-label="API Lens workflow">
        <div>
          <Route :size="16" />
          <strong>{{ preferences.t("apiLensStepTarget") }}</strong>
          <span>{{ preferences.t("apiLensStepTargetDetail") }}</span>
        </div>
        <div>
          <Copy :size="16" />
          <strong>{{ preferences.t("apiLensStepProxy") }}</strong>
          <span>{{ preferences.t("apiLensStepProxyDetail") }}</span>
        </div>
        <div>
          <MousePointerClick :size="16" />
          <strong>{{ preferences.t("apiLensStepUse") }}</strong>
          <span>{{ preferences.t("apiLensStepUseDetail") }}</span>
        </div>
        <div>
          <ShieldCheck :size="16" />
          <strong>{{ preferences.t("apiLensStepInspect") }}</strong>
          <span>{{ preferences.t("apiLensStepInspectDetail") }}</span>
        </div>
      </div>
    </section>

    <div class="api-lens-grid">
      <aside class="api-lens-targets surface">
        <div class="surface-heading">
          <span>{{ preferences.t("apiLensTargets") }}</span>
          <Activity :size="16" />
        </div>
        <form class="api-lens-target-form" @submit.prevent="submitTarget">
          <label>
            {{ preferences.t("apiLensTargetName") }}
            <input v-model="targetName" :placeholder="preferences.t('apiLensTargetNamePlaceholder')" />
          </label>
          <label>
            {{ preferences.t("apiLensBaseUrl") }}
            <input v-model="baseUrl" placeholder="http://127.0.0.1:8000" />
          </label>
          <button class="primary-button" type="submit">
            <Plus :size="15" />
            {{ preferences.t("apiLensAddTarget") }}
          </button>
        </form>

        <div class="api-lens-target-list">
          <div
            v-for="target in store.targets"
            :key="target.id"
            class="api-lens-target-row"
            :class="{ active: target.id === store.selectedTargetId }"
          >
            <button class="api-lens-target" type="button" @click="selectTarget(target.id)">
              <strong>{{ target.name }}</strong>
              <span>{{ target.baseUrl }}</span>
            </button>
            <button class="api-lens-target-delete" type="button" @click="deleteTarget(target.id)">
              <Trash2 :size="14" />
            </button>
          </div>
          <div v-if="store.targets.length === 0" class="muted-block">
            {{ preferences.t("apiLensEmptyTargets") }}
          </div>
        </div>
      </aside>

      <main class="api-lens-main">
        <section class="api-lens-proxy surface">
          <div>
            <span>{{ preferences.t("apiLensProxyUrl") }}</span>
            <strong>{{ proxyUrl || preferences.t("apiLensNoTarget") }}</strong>
          </div>
          <button class="text-button" type="button" :disabled="!proxyUrl" @click="copyProxyUrl">
            <Copy :size="15" />
            {{ preferences.t("copy") }}
          </button>
        </section>

        <section class="api-lens-filters surface">
          <select v-model="methodFilter" :aria-label="preferences.t('apiLensMethodFilter')">
            <option value="">{{ preferences.t("apiLensAllMethods") }}</option>
            <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
          </select>
          <select v-model="statusFilter" :aria-label="preferences.t('apiLensStatusFilter')">
            <option value="">{{ preferences.t("apiLensAllStatuses") }}</option>
            <option value="error">{{ preferences.t("apiLensErrors") }}</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
          <input v-model="query" :placeholder="preferences.t('apiLensSearchPlaceholder')" />
        </section>

        <div class="api-lens-content">
          <section class="api-lens-requests surface">
            <div class="surface-heading">
              <span>{{ preferences.t("apiLensRequests") }}</span>
              <span>{{ filteredRequests.length }}</span>
            </div>
            <button
              v-for="request in filteredRequests"
              :key="request.id"
              class="api-lens-request"
              :class="{ active: request.id === selectedRequest?.id }"
              type="button"
              @click="store.selectRequest(request.id)"
            >
              <span class="request-method">{{ request.method }}</span>
              <strong>{{ request.path }}</strong>
              <em :class="statusTone(request)">{{ statusLabel(request) }}</em>
              <span>{{ request.durationMs }}ms</span>
            </button>
            <div v-if="filteredRequests.length === 0" class="muted-block">
              {{ preferences.t("apiLensEmptyRequests") }}
            </div>
          </section>

          <section class="api-lens-detail surface">
            <div class="surface-heading">
              <span>{{ preferences.t("apiLensRequestDetail") }}</span>
              <button class="text-button" type="button" :disabled="!selectedRequest" @click="copyContext">
                <Bot :size="15" />
                {{ preferences.t("copyAiContext") }}
              </button>
            </div>
            <div v-if="selectedRequest" class="api-lens-detail-body">
              <div class="api-lens-facts">
                <div><span>{{ preferences.t("apiLensMethod") }}</span><strong>{{ selectedRequest.method }}</strong></div>
                <div><span>{{ preferences.t("apiLensStatus") }}</span><strong>{{ statusLabel(selectedRequest) }}</strong></div>
                <div><span>{{ preferences.t("apiLensDuration") }}</span><strong>{{ selectedRequest.durationMs }}ms</strong></div>
                <div><span>{{ preferences.t("apiLensStartedAt") }}</span><strong>{{ formatTime(selectedRequest.startedAt) }}</strong></div>
              </div>
              <div v-if="selectedRequest.error" class="api-lens-error">{{ selectedRequest.error }}</div>
              <div class="api-lens-preview-grid">
                <div>
                  <h3>{{ preferences.t("apiLensRequestBody") }}</h3>
                  <pre>{{ stringifyPreview(selectedRequest.request.body ?? selectedRequest.request.headers) }}</pre>
                </div>
                <div>
                  <h3>{{ preferences.t("apiLensResponseBody") }}</h3>
                  <pre>{{ stringifyPreview(selectedRequest.response?.body ?? selectedRequest.response?.headers ?? selectedRequest.error ?? "") }}</pre>
                </div>
              </div>
            </div>
            <div v-else class="muted-block">{{ preferences.t("apiLensSelectRequest") }}</div>
          </section>
        </div>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Activity, Bot, Copy, MousePointerClick, Plus, RefreshCw, Route, ShieldCheck, Trash2 } from "lucide-vue-next";
import type { ApiLensRequestRecord } from "../../api";
import { useApiLensStore } from "../../stores/api-lens";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";

const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const store = useApiLensStore();
const targetName = ref("");
const baseUrl = ref("");
const methodFilter = ref("");
const statusFilter = ref("");
const query = ref("");
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
let refreshTimer: number | undefined;

const proxyUrl = computed(() => {
  const target = store.selectedTarget;
  return target ? `${window.location.origin}/lens/${encodeURIComponent(target.id)}/` : "";
});

const selectedRequest = computed(() => store.selectedRequest);
const filteredRequests = computed(() =>
  store.requests.filter((request) => matchesMethod(request) && matchesStatus(request) && matchesQuery(request))
);

onMounted(async () => {
  await store.load();
  refreshTimer = window.setInterval(() => {
    void store.refreshRequests();
  }, 3000);
});

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

async function submitTarget(): Promise<void> {
  const target = await store.createTarget({ name: targetName.value, baseUrl: baseUrl.value });
  if (!target) {
    notifications.error(store.error || preferences.t("apiLensTargetFailed"));
    return;
  }
  targetName.value = "";
  baseUrl.value = "";
  notifications.success(preferences.t("apiLensTargetAdded"));
}

async function selectTarget(targetId: string): Promise<void> {
  store.selectTarget(targetId);
  await store.refreshRequests();
}

async function deleteTarget(targetId: string): Promise<void> {
  const ok = await store.deleteTarget(targetId);
  if (!ok) notifications.error(store.error);
}

async function copyProxyUrl(): Promise<void> {
  if (!proxyUrl.value) return;
  await navigator.clipboard.writeText(proxyUrl.value);
  notifications.success(preferences.t("pathCopiedNotice"));
}

async function copyContext(): Promise<void> {
  if (!selectedRequest.value) return;
  const copied = await store.copyRequestContext(selectedRequest.value.id);
  if (copied) notifications.success(preferences.t("contextCopiedNotice"));
  else notifications.error(store.error || preferences.t("contextCopyFailedNotice", { message: "API Lens" }));
}

function matchesMethod(request: ApiLensRequestRecord): boolean {
  return !methodFilter.value || request.method === methodFilter.value;
}

function matchesStatus(request: ApiLensRequestRecord): boolean {
  if (!statusFilter.value) return true;
  if (statusFilter.value === "error") return Boolean(request.error);
  if (!request.status) return false;
  const group = Math.floor(request.status / 100);
  return statusFilter.value === `${group}xx`;
}

function matchesQuery(request: ApiLensRequestRecord): boolean {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return true;
  return `${request.method} ${request.path} ${request.status ?? ""} ${request.error ?? ""}`.toLowerCase().includes(needle);
}

function statusLabel(request: ApiLensRequestRecord): string {
  if (request.error) return preferences.t("apiLensFailed");
  return request.status ? String(request.status) : preferences.t("unknown");
}

function statusTone(request: ApiLensRequestRecord): string {
  if (request.error || (request.status && request.status >= 500)) return "danger";
  if (request.status && request.status >= 400) return "warn";
  if (request.status && request.status < 300) return "good";
  return "neutral";
}

function stringifyPreview(value: unknown): string {
  if (!value) return preferences.t("none");
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(preferences.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}
</script>
