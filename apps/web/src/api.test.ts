import { afterEach, describe, expect, it, vi } from "vitest";
import { RootFolderPickerUnavailableError, chooseRootFolder, getApiLensTargets } from "./api";

describe("chooseRootFolder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a missing picker endpoint as a restartable compatibility issue", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Cannot POST /api/dialogs/open-folder", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chooseRootFolder("D:\\projects")).rejects.toBeInstanceOf(RootFolderPickerUnavailableError);
    expect(fetchMock).toHaveBeenCalledWith("/api/dialogs/open-folder", expect.objectContaining({ method: "POST" }));
  });

  it("keeps real server errors visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Folder picker failed with exit code 1" }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
      )
    );

    await expect(chooseRootFolder()).rejects.toThrow("Folder picker failed with exit code 1");
  });
});

describe("API JSON responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an HTML fallback response as a server connection problem", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><html><body>Dev Cockpit</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" }
        })
      )
    );

    await expect(getApiLensTargets()).rejects.toThrow("returned HTML instead of JSON");
  });
});
