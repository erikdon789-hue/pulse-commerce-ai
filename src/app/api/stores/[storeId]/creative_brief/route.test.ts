import { describe, it, expect, vi } from "vitest";

// Same chainable+awaitable fake used by the other pipeline route tests —
// real Supabase query builders are thenable at every point in the chain.
function fakeSupabase(tableResults: Record<string, { data: unknown; error?: unknown }>) {
  const updated: Record<string, unknown[]> = {};

  function makeChain(table: string, terminalResult: { data: unknown; error?: unknown }) {
    const chain: {
      insert: (payload: unknown) => typeof chain;
      update: (payload: unknown) => typeof chain;
      select: () => typeof chain;
      eq: () => typeof chain;
      in: () => typeof chain;
      order: () => typeof chain;
      limit: () => typeof chain;
      maybeSingle: () => Promise<typeof terminalResult>;
      single: () => Promise<typeof terminalResult>;
      then: (resolve: (v: typeof terminalResult) => void) => void;
    } = {
      insert: (payload: unknown) => {
        (updated[table] ??= []).push(payload);
        return chain;
      },
      update: (payload: unknown) => {
        (updated[table] ??= []).push(payload);
        return chain;
      },
      select: () => chain,
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
    __updated: updated,
  };
}

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

const AI_BRIEF_RESPONSE = {
  logo_brief: "A clean mark.",
  logo_image_prompt: "minimalist logo",
  ad_banners: [
    { platform: "tiktok", brief: "hook", image_prompt: "tiktok banner" },
    { platform: "instagram", brief: "hook", image_prompt: "instagram banner" },
    { platform: "facebook", brief: "hook", image_prompt: "facebook banner" },
  ],
};

async function loadRouteWithMocks(opts: {
  brandCreativeBrief?: unknown;
  generateStructuredMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const generateStructured =
    opts.generateStructuredMock ?? vi.fn(async () => AI_BRIEF_RESPONSE);

  const supabase = fakeSupabase({
    brand_identity: {
      data: {
        id: "brand-1",
        brand_name: "Aura",
        slogan: "Warmth, poured.",
        colors: {},
        fonts: {},
        tone_of_voice: "warm",
        creative_brief: opts.brandCreativeBrief ?? null,
      },
    },
    product_analysis: { data: { marketing_angles: ["cozy mornings"] } },
  });

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));
  vi.doMock("@/lib/ai/generate", () => ({ generateStructured }));

  const { POST } = await import("./route");
  return { POST, supabase, generateStructured };
}

describe("POST /api/stores/[storeId]/creative_brief", () => {
  it("generates and persists the brief on first call", async () => {
    const { POST, supabase, generateStructured } = await loadRouteWithMocks({});

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.brief).toEqual(AI_BRIEF_RESPONSE);
    expect(generateStructured).toHaveBeenCalledTimes(1);

    const savedUpdate = supabase.__updated.brand_identity[0] as { creative_brief: unknown };
    expect(savedUpdate.creative_brief).toEqual(AI_BRIEF_RESPONSE);
  });

  it("is idempotent — a retry after the brief already exists does not call OpenAI again", async () => {
    const generateStructured = vi.fn(async () => AI_BRIEF_RESPONSE);
    const { POST } = await loadRouteWithMocks({
      brandCreativeBrief: AI_BRIEF_RESPONSE,
      generateStructuredMock: generateStructured,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.brief).toEqual(AI_BRIEF_RESPONSE);
    expect(generateStructured).not.toHaveBeenCalled();
  });
});
