import { defineStore } from "pinia";
import {
  clearApiLensRequests,
  createApiLensTarget,
  deleteApiLensTarget,
  getApiLensRequestContext,
  getApiLensRequests,
  getApiLensTargets,
  type ApiLensRequestRecord,
  type ApiLensTarget
} from "../api";

export const useApiLensStore = defineStore("apiLens", {
  state: () => ({
    targets: [] as ApiLensTarget[],
    requests: [] as ApiLensRequestRecord[],
    selectedTargetId: "",
    selectedRequestId: "",
    loading: false,
    error: ""
  }),
  getters: {
    selectedTarget(state): ApiLensTarget | undefined {
      return state.targets.find((target) => target.id === state.selectedTargetId) ?? state.targets[0];
    },
    selectedRequest(state): ApiLensRequestRecord | undefined {
      return state.requests.find((request) => request.id === state.selectedRequestId) ?? state.requests[0];
    }
  },
  actions: {
    async load(): Promise<void> {
      this.loading = true;
      this.error = "";
      try {
        this.targets = await getApiLensTargets();
        if (!this.selectedTargetId && this.targets[0]) this.selectedTargetId = this.targets[0].id;
        await this.refreshRequests();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    async refreshRequests(): Promise<void> {
      try {
        this.requests = await getApiLensRequests({ targetId: this.selectedTargetId || undefined, limit: 200 });
        if (this.selectedRequestId && !this.requests.some((request) => request.id === this.selectedRequestId)) {
          this.selectedRequestId = this.requests[0]?.id ?? "";
        }
        this.error = "";
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    selectTarget(targetId: string): void {
      this.selectedTargetId = targetId;
      this.selectedRequestId = "";
    },
    selectRequest(requestId: string): void {
      this.selectedRequestId = requestId;
    },
    async createTarget(input: { name: string; baseUrl: string; projectId?: string }): Promise<ApiLensTarget | undefined> {
      try {
        const target = await createApiLensTarget(input);
        this.targets = [target, ...this.targets.filter((item) => item.id !== target.id)];
        this.selectedTargetId = target.id;
        this.error = "";
        await this.refreshRequests();
        return target;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    },
    async deleteTarget(targetId: string): Promise<boolean> {
      try {
        await deleteApiLensTarget(targetId);
        this.targets = this.targets.filter((target) => target.id !== targetId);
        if (this.selectedTargetId === targetId) this.selectedTargetId = this.targets[0]?.id ?? "";
        this.error = "";
        await this.refreshRequests();
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    },
    async clearRequests(): Promise<void> {
      try {
        await clearApiLensRequests(this.selectedTargetId || undefined);
        this.requests = [];
        this.selectedRequestId = "";
        this.error = "";
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    async copyRequestContext(requestId: string): Promise<string | undefined> {
      try {
        const context = await getApiLensRequestContext(requestId);
        await navigator.clipboard.writeText(context);
        this.error = "";
        return context;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    }
  }
});
