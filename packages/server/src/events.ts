import { WebSocketServer } from "ws";

export interface ServerEvent {
  type: string;
  payload: unknown;
  at: string;
}

export class EventBus {
  private wss?: WebSocketServer;

  attach(wss: WebSocketServer): void {
    this.wss = wss;
  }

  emit(type: string, payload: unknown): void {
    const event: ServerEvent = { type, payload, at: new Date().toISOString() };
    const data = JSON.stringify(event);
    for (const client of this.wss?.clients ?? []) {
      if (client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }
}

