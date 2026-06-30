import type { ResourceStatus } from "../../api";

export type ResourceExportMode = "all" | "filtered" | "selected" | "status" | "category";
export type ResourceExportPicker = "" | "status" | "category";

export interface ResourceExportOption {
  mode: ResourceExportMode;
  label: string;
  description: string;
  count: number;
}

export interface ResourceExportStatusOption {
  value: ResourceStatus;
  label: string;
}

export interface ResourceExportCategoryOption {
  value: string;
  label: string;
  count: number;
}
