export interface ApiLensTarget {
  id: string;
  name: string;
  baseUrl: string;
  projectId?: string;
  createdAt: string;
}

export interface ApiLensPayloadPreview {
  contentType?: string;
  size: number;
  truncated: boolean;
  body?: unknown;
}

export interface ApiLensRequestRecord {
  id: string;
  targetId: string;
  method: string;
  path: string;
  status?: number;
  durationMs: number;
  startedAt: string;
  request: {
    headers: Record<string, string>;
    body?: ApiLensPayloadPreview;
  };
  response?: {
    headers: Record<string, string>;
    body?: ApiLensPayloadPreview;
  };
  error?: string;
}
