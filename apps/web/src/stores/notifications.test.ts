import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useNotificationsStore } from "./notifications";

describe("notifications store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps the newest four notifications", () => {
    const store = useNotificationsStore();

    for (const label of ["one", "two", "three", "four", "five"]) {
      store.info(label);
    }

    expect(store.items.map((item) => item.message)).toEqual(["five", "four", "three", "two"]);
  });

  it("dismisses individual notifications", () => {
    const store = useNotificationsStore();
    const item = store.success("copied");

    store.dismiss(item.id);

    expect(store.items).toEqual([]);
  });
});
