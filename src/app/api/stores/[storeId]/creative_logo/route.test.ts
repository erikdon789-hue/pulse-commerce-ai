import { describe, it, expect, vi } from "vitest";

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

const BRIEF = {
  logo_brief: "A clean mark.",
  logo_image_prompt: "minimalist logo",
  ad_banners: [
    { platform: "tiktok", brief: "hook-tiktok", image_prompt: "tiktok banner" },
    { platform: "instagram", brief: "hook-ig", image_prompt: "instagram banner" },
    { platform: "facebook", brief: "hook-fb", image_prompt: "facebook banner" },
  ],
};

type Row = Record<string, unknown>;

// Stateful fake modeling the two things this route depends on for
// correctness: creative_assets as a real table (so the idempotent
// short-circuit is observable) and the creative_assets_unique_logo partial
// index (0006_creative_brief_split.sql), simulated via a 23505 error when
// `insertShouldConflict` is set.
function fakeSupabase(opts: { brand: Row | null; existingLogo?: Row | null; insertShouldConflict?: boolean }) {
  let logo: Row | null = opts.existingLogo ?? null;
  const brandUpdates: Row[] = [];

  function makeChain(table: string) {
    let pendingInsert: Row | null = null;
    let pendingUpdate: Row | null = null;

    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload: Row) => {
        pendingInsert = payload;
        return chain;
      },
      update: (payload: Row) => {
        pendingUpdate = payload;
        return chain;
      },
      maybeSingle: async () => {
        if (table === "brand_identity") return { data: opts.brand, error: null };
        if (table === "creative_assets") return { data: logo, error: null };
        return { data: null, error: null };
      },
      single: async () => {
        if (table === "creative_assets" && pendingInsert) {
          if (opts.insertShouldConflict) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          logo = { id: "asset-logo", ...pendingInsert };
          return { data: logo, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === "brand_identity" && pendingUpdate) {
          brandUpdates.push(pendingUpdate);
          resolve({ data: null, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => makeChain(table),
    __logo: () => logo,
    __brandUpdates: brandUpdates,
  };
}

async function loadRouteWithMocks(opts: {
  brand: Row | null;
  existingLogo?: Row | null;
  insertShouldConflict?: boolean;
  generateImageBufferMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const generateImageBuffer =
    opts.generateImageBufferMock ?? vi.fn(async () => Buffer.from("fake-png-bytes"));
  const uploadGeneratedImage = vi.fn(async (path: string) => `https://cdn.test/${path}`);

  const supabase = fakeSupabase({
    brand: opts.brand,
    existingLogo: opts.existingLogo,
    insertShouldConflict: opts.insertShouldConflict,
  });

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));
  vi.doMock("@/lib/ai/images", () => ({ generateImageBuffer }));
  vi.doMock("@/lib/supabase/storage", () => ({ uploadGeneratedImage }));

  const { POST } = await import("./route");
  return { POST, supabase, generateImageBuffer };
}

describe("POST /api/stores/[storeId]/creative_logo", () => {
  it("requires the creative brief step to have run first", async () => {
    const { POST } = await loadRouteWithMocks({ brand: { creative_brief: null } });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("PIPELINE_STEP_MISSING");
  });

  it("generates, uploads, and persists the logo, and updates brand_identity.logo_url", async () => {
    const { POST, supabase, generateImageBuffer } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(generateImageBuffer).toHaveBeenCalledTimes(1);
    expect(generateImageBuffer).toHaveBeenCalledWith(BRIEF.logo_image_prompt);
    expect(body.data.logoAsset.image_url).toMatch(/^https:\/\/cdn\.test\/store-1\/logo-/);
    expect(supabase.__brandUpdates[0]?.logo_url).toBe(body.data.logoAsset.image_url);
  });

  it("is idempotent — a retry after the logo already exists does not call OpenAI again", async () => {
    const existingLogo = {
      id: "asset-0",
      store_id: "store-1",
      type: "logo",
      platform: null,
      brief_text: "x",
      image_url: "https://cdn.test/logo.png",
    };
    const generateImageBuffer = vi.fn(async () => Buffer.from("fake"));
    const { POST } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
      existingLogo,
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.logoAsset).toEqual(existingLogo);
    expect(generateImageBuffer).not.toHaveBeenCalled();
  });

  it("recovers cleanly when a concurrent request wins the insert race (23505)", async () => {
    const { POST } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
      insertShouldConflict: true,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
