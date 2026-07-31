import { describe, it, expect, vi } from "vitest";
import { calculateSellingPrice } from "@/lib/pricing/calculate";

// Same chainable+awaitable fake as the ingest route test — real Supabase
// query builders are thenable at every point in the chain, so a plain
// object with only async terminal methods isn't enough.
function fakeSupabase(tableResults: Record<string, { data: unknown; error?: unknown }>) {
  const upserted: Record<string, unknown[]> = {};

  function makeChain(table: string, terminalResult: { data: unknown; error?: unknown }) {
    const chain: {
      insert: (payload: unknown) => typeof chain;
      upsert: (payload: unknown) => typeof chain;
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
        (upserted[table] ??= []).push(payload);
        return chain;
      },
      upsert: (payload: unknown) => {
        (upserted[table] ??= []).push(payload);
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
    from: (table: string) => makeChain(table, tableResults[table] ?? { data: null, error: null }),
    __upserted: upserted,
  };
}

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

const BASE_TABLES = {
  product_analysis: {
    data: { positioning: "premium", target_audience: { age: "25-40" } },
  },
  brand_identity: {
    data: { brand_name: "Aura", tone_of_voice: "warm" },
  },
};

// What the AI would return — includes its own price guess, which the route
// must override whenever the product's cost is known.
const AI_CONTENT_RESPONSE = {
  title: "Premium Ceramic Mug",
  description: "A mug.",
  benefits: ["Keeps drinks warm"],
  faqs: [{ question: "Dishwasher safe?", answer: "Yes" }],
  review_placeholders: [{ reviewer_name: "Alex", rating: 5, body: "Great!" }],
  pricing_strategy: {
    suggested_price_cents: 999999, // deliberately wrong — must be overridden when cost is known
    compare_at_price_cents: null as number | null,
    reasoning: "AI's own guess",
  },
  upsells: [{ name: "Coaster", pitch: "Pairs nicely" }],
};

async function loadRouteWithMocks(opts: {
  productPriceCents: number | null;
  aiCompareAt?: number | null;
}) {
  vi.resetModules();

  const supabase = fakeSupabase({
    ...BASE_TABLES,
    store_products: { data: { id: "sp-1", price_cents: opts.productPriceCents } },
    product_content: { data: { id: "pc-1" } },
  });

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));

  vi.doMock("@/lib/ai/generate", () => ({
    generateStructured: vi.fn(async () => ({
      ...AI_CONTENT_RESPONSE,
      pricing_strategy: { ...AI_CONTENT_RESPONSE.pricing_strategy, compare_at_price_cents: opts.aiCompareAt ?? null },
    })),
  }));

  const { POST } = await import("./route");
  return { POST, supabase };
}

describe("POST /api/stores/[storeId]/content — pricing integration", () => {
  it("overrides the AI's price with the deterministic pricing engine's result when cost is known", async () => {
    const { POST, supabase } = await loadRouteWithMocks({ productPriceCents: 1_820 });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    expect(res.status).toBe(200);

    const expected = calculateSellingPrice({ baseCostCents: 1_820 });
    const saved = supabase.__upserted.product_content[0] as {
      pricing_strategy: { suggested_price_cents: number; reasoning: string };
    };
    expect(saved.pricing_strategy.suggested_price_cents).toBe(expected.priceCents);
    expect(saved.pricing_strategy.suggested_price_cents).toBe(5_499); // matches the confirmed worked example
    expect(saved.pricing_strategy.reasoning).toContain("Calculated via pricing rules");
  });

  it("falls back to the AI's own price when the product's cost is unknown", async () => {
    const { POST, supabase } = await loadRouteWithMocks({ productPriceCents: null });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    expect(res.status).toBe(200);

    const saved = supabase.__upserted.product_content[0] as {
      pricing_strategy: { suggested_price_cents: number; reasoning: string };
    };
    expect(saved.pricing_strategy.suggested_price_cents).toBe(999_999);
    expect(saved.pricing_strategy.reasoning).toBe("AI's own guess");
  });

  it("drops a compare-at price that isn't actually above the calculated selling price", async () => {
    // 5499 is the real price for a 1820-cent cost; 5000 is below it, so the
    // AI's proposed "was $50" framing would be a broken (higher-than-real)
    // discount and must be dropped.
    const { POST, supabase } = await loadRouteWithMocks({ productPriceCents: 1_820, aiCompareAt: 5_000 });

    await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });

    const saved = supabase.__upserted.product_content[0] as {
      pricing_strategy: { compare_at_price_cents: number | null };
    };
    expect(saved.pricing_strategy.compare_at_price_cents).toBeNull();
  });

  it("keeps a compare-at price that is genuinely above the calculated selling price", async () => {
    const { POST, supabase } = await loadRouteWithMocks({ productPriceCents: 1_820, aiCompareAt: 7_999 });

    await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });

    const saved = supabase.__upserted.product_content[0] as {
      pricing_strategy: { compare_at_price_cents: number | null };
    };
    expect(saved.pricing_strategy.compare_at_price_cents).toBe(7_999);
  });
});
