import { describe, it, expect, vi } from "vitest";

function fakeSupabase(tableResults: Record<string, { data: unknown; error?: unknown }>) {
  function makeChain(terminalResult: { data: unknown; error?: unknown }) {
    const chain: {
      select: () => typeof chain;
      update: () => typeof chain;
      insert: () => typeof chain;
      eq: () => typeof chain;
      in: () => typeof chain;
      order: () => typeof chain;
      limit: () => typeof chain;
      maybeSingle: () => Promise<typeof terminalResult>;
      then: (resolve: (v: typeof terminalResult) => void) => void;
    } = {
      select: () => chain,
      update: () => chain,
      insert: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => terminalResult,
      then: (resolve) => resolve(terminalResult),
    };
    return chain;
  }

  return {
    from: (table: string) => makeChain(tableResults[table] ?? { data: null, error: null }),
  };
}

const FAKE_STORE = { id: "store-1", owner_id: "user-1", name: "Test Store", collection_title: null, collection_description: null };

// A supplier-sourced store_products row: currency stored lowercase (as
// written by the ingest route's supplier-import mode), images as a plain
// string array — exactly what push/route.ts needs to map correctly.
const SUPPLIER_SOURCED_PRODUCT = {
  id: "sp-1",
  title: "Ceramic Coffee Mug",
  description: "A nice mug.",
  currency: "usd",
  images: ["https://cj.example/mug.jpg"],
};

const CONTENT_WITH_CALCULATED_PRICE = {
  title: "Ceramic Coffee Mug",
  description: "A nice mug.",
  benefits: ["Keeps drinks warm"],
  faqs: [{ question: "Dishwasher safe?", answer: "Yes" }],
  pricing_strategy: { suggested_price_cents: 5_499, compare_at_price_cents: null, reasoning: "Calculated via pricing rules" },
};

const SEO_CONTENT = { keywords: ["mug", "ceramic"] };

async function loadRouteWithMocks() {
  vi.resetModules();

  const supabase = fakeSupabase({
    store_products: { data: SUPPLIER_SOURCED_PRODUCT },
    product_content: { data: CONTENT_WITH_CALCULATED_PRICE },
    seo_content: { data: SEO_CONTENT },
  });
  const serviceClient = fakeSupabase({
    shopify_connections: { data: { shop_domain: "test-shop.myshopify.com", access_token: "tok" } },
  });

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));
  vi.doMock("@/lib/supabase/service", () => ({
    createServiceClient: () => serviceClient,
  }));

  const createShopifyProduct = vi.fn(async (_client: unknown, args: Record<string, unknown>) => ({
    handle: "ceramic-mug",
    ...args,
  }));
  const createShopifyCollection = vi.fn(async () => ({ handle: "collection" }));
  vi.doMock("@/lib/shopify/client", () => ({
    createShopifyAdminClient: vi.fn(() => ({})),
    createShopifyCollection,
    createShopifyProduct,
  }));

  const { POST } = await import("./route");
  return { POST, createShopifyProduct };
}

describe("POST /api/stores/[storeId]/shopify/push — supplier-sourced product mapping", () => {
  it("builds Shopify-ready product data from a supplier-sourced store_products row", async () => {
    const { POST, createShopifyProduct } = await loadRouteWithMocks();

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    expect(res.status).toBe(200);

    expect(createShopifyProduct).toHaveBeenCalledTimes(1);
    const [, args] = createShopifyProduct.mock.calls[0] as [unknown, Record<string, unknown>];

    // The calculated selling price ($54.99), not the supplier cost.
    expect(args.priceAmount).toBe(54.99);
    // Lowercase-stored currency (set by the supplier-import ingest mode)
    // correctly uppercased for Shopify's API.
    expect(args.currencyCode).toBe("USD");
    expect(args.images).toEqual(["https://cj.example/mug.jpg"]);
    expect(args.tags).toEqual(["mug", "ceramic"]);
    expect(args.descriptionHtml).toContain("Keeps drinks warm");
    expect(args.descriptionHtml).toContain("Dishwasher safe?");
  });
});
