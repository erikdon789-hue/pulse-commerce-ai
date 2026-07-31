import { describe, it, expect, vi } from "vitest";
import type { SupplierProvider } from "@/lib/suppliers/types";

vi.mock("@/lib/pipeline/guard", () => ({
  requireUser: vi.fn(async () => ({ supabase: {}, user: { id: "user-1" } })),
}));

function fakeProvider(overrides: Partial<SupplierProvider>): SupplierProvider {
  return {
    id: "cjdropshipping",
    isConfigured: () => true,
    search: vi.fn(),
    getProduct: vi.fn(),
    ...overrides,
  };
}

describe("GET /api/suppliers/search", () => {
  it("400s when keyword is missing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/suppliers/registry", () => ({ listAllProviders: () => [] }));
    const { GET } = await import("./route");
    const res = await GET(new Request("http://test/api/suppliers/search"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400s on an unknown supplier filter", async () => {
    vi.resetModules();
    vi.doMock("@/lib/suppliers/registry", () => ({ listAllProviders: () => [] }));
    const { GET } = await import("./route");
    const res = await GET(new Request("http://test/api/suppliers/search?keyword=mug&supplier=temu"));
    expect(res.status).toBe(400);
  });

  it("aggregates results, skips unconfigured suppliers, and reports per-supplier errors without failing the whole request", async () => {
    const configured = fakeProvider({
      id: "cjdropshipping",
      isConfigured: () => true,
      search: vi.fn(async () => ({
        supplier: "cjdropshipping" as const,
        products: [],
        page: 1,
        pageSize: 20,
        totalRecords: 0,
      })),
    });
    const unconfigured = fakeProvider({ id: "aliexpress", isConfigured: () => false });
    const broken = fakeProvider({
      id: "alibaba",
      isConfigured: () => true,
      search: vi.fn(async () => {
        throw new Error("not implemented");
      }),
    });

    vi.resetModules();
    vi.doMock("@/lib/suppliers/registry", () => ({
      listAllProviders: () => [configured, unconfigured, broken],
    }));
    const { GET } = await import("./route");

    const res = await GET(new Request("http://test/api/suppliers/search?keyword=mug"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0].supplier).toBe("cjdropshipping");
    expect(body.data.skipped).toEqual(["aliexpress"]);
    expect(body.data.errors).toEqual([{ supplier: "alibaba", message: "not implemented" }]);
  });

  it("filters to only the requested supplier(s)", async () => {
    const cj = fakeProvider({
      id: "cjdropshipping",
      search: vi.fn(async () => ({
        supplier: "cjdropshipping" as const,
        products: [],
        page: 1,
        pageSize: 20,
        totalRecords: 0,
      })),
    });
    const ali = fakeProvider({ id: "aliexpress", search: vi.fn() });

    vi.resetModules();
    vi.doMock("@/lib/suppliers/registry", () => ({ listAllProviders: () => [cj, ali] }));
    const { GET } = await import("./route");

    await GET(new Request("http://test/api/suppliers/search?keyword=mug&supplier=cjdropshipping"));
    expect(cj.search).toHaveBeenCalled();
    expect(ali.search).not.toHaveBeenCalled();
  });
});
