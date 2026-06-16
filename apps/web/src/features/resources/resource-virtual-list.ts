export interface VirtualResourceListState {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

export const RESOURCE_VIRTUAL_LIST_THRESHOLD = 80;

export function shouldVirtualizeResourceList(total: number): boolean {
  return Math.max(0, Math.floor(total)) > RESOURCE_VIRTUAL_LIST_THRESHOLD;
}

/**
 * Calculates the fixed-row virtual window used by the resource library.
 * Keeping this as a pure function makes large-list behavior easy to test
 * without mounting the Vue component.
 */
export function calculateVirtualResourceWindow(input: {
  total: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan: number;
}): VirtualResourceListState {
  const total = Math.max(0, Math.floor(input.total));
  const rowHeight = Math.max(1, input.rowHeight);
  const viewportHeight = Math.max(0, input.viewportHeight);
  const scrollTop = Math.max(0, input.scrollTop);
  const overscan = Math.max(0, Math.floor(input.overscan));

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const endIndex = Math.min(total, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    totalHeight: total * rowHeight
  };
}
