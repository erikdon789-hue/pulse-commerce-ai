import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function freshRegistry() {
  vi.resetModules();
  return import("./registry");
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("supplier registry", () => {
  it("lists all three suppliers regardless of configuration", async () => {
    const { listAllProviders } = await freshRegistry();
    const ids = listAllProviders()
      .map((p) => p.id)
      .sort();
    expect(ids).toEqual(["alibaba", "aliexpress", "cjdropshipping"]);
  });

  it("listConfiguredProviders() only returns suppliers with credentials present", async () => {
    vi.stubEnv("CJ_DROPSHIPPING_API_KEY", "test-key");
    const { listConfiguredProviders } = await freshRegistry();
    const ids = listConfiguredProviders().map((p) => p.id);
    expect(ids).toEqual(["cjdropshipping"]);
  });

  it("returns no configured providers when no credentials are set", async () => {
    const { listConfiguredProviders } = await freshRegistry();
    expect(listConfiguredProviders()).toEqual([]);
  });

  it("getSupplierProvider() looks up a provider by id", async () => {
    const { getSupplierProvider } = await freshRegistry();
    expect(getSupplierProvider("aliexpress")?.id).toBe("aliexpress");
  });
});
