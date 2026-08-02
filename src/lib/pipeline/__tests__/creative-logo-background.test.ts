import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Same chainable+awaitable fake used by the other pipeline tests — real
// Supabase query builders are thenable at every point in the chain.
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

const SECRET = "test-secret";

async function loadHandlerWithMocks(opts: {
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

  vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => supabase }));
  vi.doMock("@/lib/ai/images", () => ({ generateImageBuffer }));
  vi.doMock("@/lib/supabase/storage", () => ({ uploadGeneratedImage }));

  const mod = await import("../../../../netlify/functions/creative-logo-background");
  return { handler: mod.default, supabase, generateImageBuffer };
}

function request(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-trigger-secret"] = secret;
  return new Request("http://test", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("creative-logo-background", () => {
  beforeEach(() => {
    process.env.INTERNAL_TRIGGER_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.INTERNAL_TRIGGER_SECRET;
  });

  it("rejects requests without the correct trigger secret", async () => {
    const { handler } = await loadHandlerWithMocks({ brand: { creative_brief: BRIEF } });

    const res = await handler(request({ storeId: "store-1" }, "wrong-secret"));

    expect(res.status).toBe(401);
  });

  it("generates, uploads, and persists the logo, and updates brand_identity.logo_url", async () => {
    const { handler, supabase, generateImageBuffer } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(generateImageBuffer).toHaveBeenCalledTimes(1);
    expect(generateImageBuffer).toHaveBeenCalledWith(BRIEF.logo_image_prompt);
    const logo = supabase.__logo() as { image_url: string } | null;
    expect(logo?.image_url).toMatch(/^https:\/\/cdn\.test\/store-1\/logo-/);
    expect(supabase.__brandUpdates[0]?.logo_url).toBe(logo?.image_url);
  });

  it("is idempotent — does nothing if the logo already exists", async () => {
    const existingLogo = {
      id: "asset-0",
      store_id: "store-1",
      type: "logo",
      platform: null,
      brief_text: "x",
      image_url: "https://cdn.test/logo.png",
    };
    const generateImageBuffer = vi.fn(async () => Buffer.from("fake"));
    const { handler } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      existingLogo,
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(generateImageBuffer).not.toHaveBeenCalled();
  });

  it("recovers cleanly when a concurrent trigger wins the insert race (23505)", async () => {
    const { handler } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      insertShouldConflict: true,
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
  });
});
