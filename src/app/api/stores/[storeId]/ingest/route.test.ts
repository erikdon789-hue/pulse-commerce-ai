import { describe, it, expect, vi } from "vitest";
import type { NormalizedProduct, SupplierProvider } from "@/lib/suppliers/types";

// Real Supabase query builders are chainable AND directly awaitable at any
// point (they implement `.then()`) — a bare object with async terminal
// methods isn't enough, since e.g. markStepComplete does
// `.select().eq().in().order().limit().maybeSingle()` while
// `stores.update(...).eq(...)` is awaited without a terminal method at all.
function fakeSupabase(insertResult: { data: unknown; error?: unknown }) {
  const inserted: unknown[] = [];

  function makeChain(terminalResult: { data: unknown; error?: unknown }) {
    const chain: {
      insert: (payload: unknown) => typeof chain;
      select: () => typeof chain;
      update: () => typeof chain;
      eq: () => typeof chain;
      in: () => typeof chain;
      order: () => typeof chain;
      limit: () => typeof chain;
      maybeSingle: () => Promise<typeof terminalResult>;
      single: () => Promise<typeof terminalResult>;
      then: (resolve: (v: typeof terminalResult) => void) => void;
    } = {
      insert: (payload: unknown) => {
        inserted.push(payload);
        return chain;
      },
      select: () => chain,
      update: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => terminalResult,
      single: async () => terminalResult,
      then: (resolve) => resolve(terminalResult),
    };
    return chain;
  }

  return {
    from: (table: string) => (table === "store_products" ? makeChain(insertResult) : makeChain({ data: null, error: null })),
    __inserted: inserted,
  };
}

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

const NORMALIZED_PRODUCT: NormalizedProduct = {
  supplier: "cjdropshipping",
  supplierProductId: "abc-123",
  title: "Ceramic Coffee Mug",
  description: null,
  images: ["https://cj.example/mug.jpg"],
  price: { amount: 9.5, currency: "USD" },
  priceRange: null,
  minOrderQuantity: null,
  sourceUrl: null,
  category: "Home",
  raw: { id: "abc-123" },
};

describe("POST /api/stores/[storeId]/ingest — supplier import mode", () => {
  it("400s on an unknown supplier", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pipeline/guard", () => ({
      requireStoreOwner: vi.fn(async () => ({ supabase: fakeSupabase({ data: null }), store: FAKE_STORE })),
    }));
    vi.doMock("@/lib/suppliers/registry", () => ({ getSupplierProvider: vi.fn() }));
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://test/api/stores/store-1/ingest", {
        method: "POST",
        body: JSON.stringify({ supplier: "temu", supplierProductId: "1" }),
      }),
      { params: Promise.resolve({ storeId: "store-1" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400s when the supplier isn't configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pipeline/guard", () => ({
      requireStoreOwner: vi.fn(async () => ({ supabase: fakeSupabase({ data: null }), store: FAKE_STORE })),
    }));
    vi.doMock("@/lib/suppliers/registry", () => ({
      getSupplierProvider: () => ({ isConfigured: () => false } as Partial<SupplierProvider>),
    }));
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://test/api/stores/store-1/ingest", {
        method: "POST",
        body: JSON.stringify({ supplier: "aliexpress", supplierProductId: "1" }),
      }),
      { params: Promise.resolve({ storeId: "store-1" }) },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("SUPPLIER_NOT_CONFIGURED");
  });

  it("404s when the supplier reports the product doesn't exist", async () => {
    vi.resetModules();
    vi.doMock("@/lib/pipeline/guard", () => ({
      requireStoreOwner: vi.fn(async () => ({ supabase: fakeSupabase({ data: null }), store: FAKE_STORE })),
    }));
    vi.doMock("@/lib/suppliers/registry", () => ({
      getSupplierProvider: () => ({
        isConfigured: () => true,
        getProduct: async () => null,
      } as Partial<SupplierProvider>),
    }));
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://test/api/stores/store-1/ingest", {
        method: "POST",
        body: JSON.stringify({ supplier: "cjdropshipping", supplierProductId: "does-not-exist" }),
      }),
      { params: Promise.resolve({ storeId: "store-1" }) },
    );
    expect(res.status).toBe(404);
  });

  it("fetches the live product and saves it as a store_products row with cost (not selling price) preserved", async () => {
    vi.resetModules();
    const supabase = fakeSupabase({
      data: { id: "sp-1", store_id: "store-1", title: NORMALIZED_PRODUCT.title },
    });
    vi.doMock("@/lib/pipeline/guard", () => ({
      requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
    }));
    vi.doMock("@/lib/suppliers/registry", () => ({
      getSupplierProvider: () => ({
        isConfigured: () => true,
        getProduct: async (id: string) => (id === "abc-123" ? NORMALIZED_PRODUCT : null),
      } as Partial<SupplierProvider>),
    }));
    const { POST } = await import("./route");

    const res = await POST(
      new Request("http://test/api/stores/store-1/ingest", {
        method: "POST",
        body: JSON.stringify({ supplier: "cjdropshipping", supplierProductId: "abc-123" }),
      }),
      { params: Promise.resolve({ storeId: "store-1" }) },
    );
    expect(res.status).toBe(201);

    const insertedPayload = supabase.__inserted[0] as {
      title: string;
      price_cents: number;
      currency: string;
      raw_fetch_data: { supplier: string; supplierProductId: string };
    };
    expect(insertedPayload.title).toBe("Ceramic Coffee Mug");
    expect(insertedPayload.price_cents).toBe(950); // $9.50 supplier cost, not a selling price
    expect(insertedPayload.currency).toBe("usd");
    expect(insertedPayload.raw_fetch_data.supplier).toBe("cjdropshipping");
    expect(insertedPayload.raw_fetch_data.supplierProductId).toBe("abc-123");
  });
});
