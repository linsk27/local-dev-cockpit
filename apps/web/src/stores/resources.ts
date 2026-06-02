import { defineStore } from "pinia";
import {
  createResource,
  commitResourcePreview,
  deleteResource,
  exportResources,
  getResourceAiConfigPayload,
  getResourceContext,
  getResources,
  importResources,
  previewResource,
  testResourceAiConfig,
  updateResource,
  updateResourceAiConfig,
  type AiProviderPresets,
  type RadarItem,
  type ResourceAiConfig,
  type ResourceAiTestResult,
  type ResourceAiConfigUpdate,
  type ResourceCreateInput,
  type ResourceExportPayload,
  type ResourceImportResult,
  type ResourceUpdateInput
} from "../api";

export const useResourcesStore = defineStore("resources", {
  state: () => ({
    items: [] as RadarItem[],
    selectedId: "" as string,
    loading: false,
    saving: false,
    previewing: false,
    error: "",
    context: "",
    previewItem: undefined as RadarItem | undefined,
    previewInput: undefined as ResourceCreateInput | undefined,
    aiConfig: undefined as ResourceAiConfig | undefined,
    aiProviders: undefined as AiProviderPresets | undefined,
    aiTestResult: undefined as ResourceAiTestResult | undefined,
    aiConfigLoading: false,
    aiConfigSaving: false,
    aiConfigTesting: false,
    importExporting: false
  }),
  getters: {
    selectedItem(state): RadarItem | undefined {
      return state.items.find((item) => item.id === state.selectedId) ?? state.items[0];
    }
  },
  actions: {
    async load(): Promise<boolean> {
      this.loading = true;
      this.error = "";
      try {
        this.items = await getResources();
        if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) {
          this.selectedId = this.items[0]?.id ?? "";
        }
        if (!this.selectedId && this.items[0]) this.selectedId = this.items[0].id;
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        this.loading = false;
      }
    },
    select(itemId: string): void {
      this.selectedId = itemId;
      this.error = "";
      this.context = "";
    },
    setError(message: string): void {
      this.error = message;
    },
    clearPreview(): void {
      this.previewItem = undefined;
      this.previewInput = undefined;
    },
    async preview(input: ResourceCreateInput): Promise<RadarItem | undefined> {
      this.previewing = true;
      this.error = "";
      try {
        const preview = await previewResource(input);
        this.previewItem = preview;
        this.previewInput = { sourceUrl: input.sourceUrl ?? "", sourceText: input.sourceText ?? "" };
        return preview;
      } catch (error) {
        this.error = friendlyResourceError(error);
        return undefined;
      } finally {
        this.previewing = false;
      }
    },
    async commitPreview(): Promise<RadarItem | undefined> {
      if (!this.previewItem) return undefined;
      this.saving = true;
      this.error = "";
      try {
        const item = await commitResourcePreview(this.previewItem);
        this.items = [item, ...this.items.filter((current) => current.id !== item.id)];
        this.clearPreview();
        this.select(item.id);
        return item;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.saving = false;
      }
    },
    async create(input: ResourceCreateInput): Promise<RadarItem | undefined> {
      this.saving = true;
      this.error = "";
      try {
        const item = await createResource(input);
        this.items = [item, ...this.items.filter((current) => current.id !== item.id)];
        this.select(item.id);
        return item;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.saving = false;
      }
    },
    async loadAiConfig(): Promise<ResourceAiConfig | undefined> {
      this.aiConfigLoading = true;
      this.error = "";
      try {
        const payload = await getResourceAiConfigPayload();
        this.aiConfig = payload.config;
        this.aiProviders = payload.providers;
        return this.aiConfig;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.aiConfigLoading = false;
      }
    },
    async saveAiConfig(input: ResourceAiConfigUpdate): Promise<ResourceAiConfig | undefined> {
      this.aiConfigSaving = true;
      this.error = "";
      try {
        this.aiConfig = await updateResourceAiConfig(input);
        this.aiTestResult = undefined;
        return this.aiConfig;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.aiConfigSaving = false;
      }
    },
    async testAiConfig(input: ResourceAiConfigUpdate): Promise<ResourceAiTestResult | undefined> {
      this.aiConfigTesting = true;
      this.error = "";
      try {
        this.aiTestResult = await testResourceAiConfig(input);
        return this.aiTestResult;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.aiConfigTesting = false;
      }
    },
    async update(itemId: string, input: ResourceUpdateInput): Promise<RadarItem | undefined> {
      this.saving = true;
      this.error = "";
      try {
        const item = await updateResource(itemId, input);
        this.items = this.items.map((current) => (current.id === item.id ? item : current));
        return item;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.saving = false;
      }
    },
    async remove(itemId: string): Promise<boolean> {
      this.saving = true;
      this.error = "";
      try {
        await deleteResource(itemId);
        this.items = this.items.filter((current) => current.id !== itemId);
        if (this.selectedId === itemId) this.selectedId = this.items[0]?.id ?? "";
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        this.saving = false;
      }
    },
    async loadContext(itemId?: string): Promise<string> {
      const id = itemId ?? this.selectedItem?.id;
      if (!id) return "";
      try {
        this.context = await getResourceContext(id);
        this.error = "";
        return this.context;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return "";
      }
    },
    async exportLibrary(): Promise<ResourceExportPayload | undefined> {
      this.importExporting = true;
      this.error = "";
      try {
        return await exportResources();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        this.importExporting = false;
      }
    },
    async importLibrary(payload: unknown): Promise<ResourceImportResult | undefined> {
      this.importExporting = true;
      this.error = "";
      try {
        const result = await importResources(payload);
        this.items = result.items;
        if (this.selectedId && !this.items.some((item) => item.id === this.selectedId)) {
          this.selectedId = this.items[0]?.id ?? "";
        }
        if (!this.selectedId && this.items[0]) this.selectedId = this.items[0].id;
        return result;
      } catch (error) {
        this.error = friendlyResourceError(error);
        return undefined;
      } finally {
        this.importExporting = false;
      }
    }
  }
});

function friendlyResourceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const issueMessage = parseApiIssueMessage(message);
  if (issueMessage) return friendlyResourceError(issueMessage);
  if (/请先粘贴链接或文本|Paste a link or text first|link or text/i.test(message)) return "请先粘贴链接或文本。";
  if (/AI.*schema|资源卡片\s*schema|AI.*结构|AI 解析结果不完整/i.test(message)) {
    return "AI 解析结果不完整，已保留本地规则预览。";
  }
  if (/schema|结构不符合|invalid/i.test(message)) return "解析结果不完整，请重试或补充文本。";
  if (/fetch|network|timeout|timed out|ECONN|ENOTFOUND/i.test(message)) return "网页抓取失败，已尽量使用本地规则。你可以补充文本后再解析。";
  return message;
}

function parseApiIssueMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      const first = parsed.find((item): item is { message: string } => {
        return typeof item === "object" && item !== null && typeof (item as { message?: unknown }).message === "string";
      });
      return first?.message ?? "";
    }
    if (typeof parsed === "object" && parsed !== null) {
      const value = (parsed as { message?: unknown; error?: unknown }).message ?? (parsed as { error?: unknown }).error;
      return typeof value === "string" ? value : "";
    }
  } catch {
    return "";
  }
  return "";
}
