import { defineStore } from "pinia";

export type NotificationTone = "info" | "success" | "error";

export interface AppNotification {
  id: string;
  message: string;
  tone: NotificationTone;
  createdAt: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 4200;
let nextNotificationId = 0;

/**
 * In-memory UI feedback. Notifications are intentionally not persisted because
 * they describe immediate actions, not durable workspace state.
 */
export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    items: [] as AppNotification[]
  }),
  actions: {
    push(message: string, tone: NotificationTone = "info", timeoutMs = DEFAULT_TIMEOUT_MS): AppNotification {
      const item: AppNotification = {
        id: `${Date.now()}-${nextNotificationId++}`,
        message,
        tone,
        createdAt: new Date().toISOString(),
        timeoutMs
      };
      this.items = [item, ...this.items].slice(0, 4);
      return item;
    },
    info(message: string): AppNotification {
      return this.push(message, "info");
    },
    success(message: string): AppNotification {
      return this.push(message, "success");
    },
    error(message: string): AppNotification {
      return this.push(message, "error", 6200);
    },
    dismiss(id: string): void {
      this.items = this.items.filter((item) => item.id !== id);
    },
    clear(): void {
      this.items = [];
    }
  }
});
