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

// Stateful fake modeling creative_assets as a real, growing table (so
// per-platform idempotency and immediate-persist-per-banner are both
// observable), plus the creative_assets_unique_banner partial index
// (0006_creative_brief_split.sql) via `conflictingPlatforms`.
function fakeSupabase(opts: {
  brand: Row | null;
  initialBanners?: Row[];
  conflictingPlatforms?: string[];
}) {
  let banners: Row[] = opts.initialBanners ? [...opts.initialBanners] : [];

  function makeChain(table: string) {
    let pendingInsert: Row | null = null;
    let selecting = false;
    let platformFilter: string | undefined;

    const chain = {
      select: () => {
        selecting = true;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        if (col === "platform") platformFilter = val as string;
        return chain;
      },
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload: Row) => {
        pendingInsert = payload;
        return chain;
      },
      update: () => chain,
      maybeSingle: async () => {
        if (table === "brand_identity") return { data: opts.brand, error: null };
        if (table === "creative_assets" && platformFilter) {
          return { data: banners.find((b) => b.platform === platformFilter) ?? null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        if (table === "creative_assets" && pendingInsert) {
          const platform = pendingInsert.platform as string;
          if (opts.conflictingPlatforms?.includes(platform)) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          const row = { id: `asset-${banners.length}`, ...pendingInsert };
          banners = [...banners, row];
          return { data: row, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === "creative_assets" && selecting && !pendingInsert) {
          resolve({ data: banners, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => makeChain(table),
    __banners: () => banners,
  };
}

const SECRET = "test-secret";

async function loadHandlerWithMocks(opts: {
  brand: Row | null;
  initialBanners?: Row[];
  conflictingPlatforms?: string[];
  generateImageBufferMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const generateImageBuffer =
    opts.generateImageBufferMock ?? vi.fn(async () => Buffer.from("fake-png-bytes"));
  const uploadGeneratedImage = vi.fn(async (path: string) => `https://cdn.test/${path}`);

  const supabase = fakeSupabase({
    brand: opts.brand,
    initialBanners: opts.initialBanners,
    conflictingPlatforms: opts.conflictingPlatforms,
  });

  vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => supabase }));
  vi.doMock("@/lib/ai/images", () => ({ generateImageBuffer }));
  vi.doMock("@/lib/supabase/storage", () => ({ uploadGeneratedImage }));

  const mod = await import("../../../../netlify/functions/creative-banners-background");
  return { handler: mod.default, supabase, generateImageBuffer };
}

function request(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-internal-trigger-secret"] = secret;
  return new Request("http://test", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("creative-banners-background", () => {
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

  it("generates and persists all 3 banners from the persisted brief", async () => {
    const { handler, supabase, generateImageBuffer } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(generateImageBuffer).toHaveBeenCalledTimes(3);
    expect(supabase.__banners()).toHaveLength(3);
    const platforms = supabase.__banners().map((b) => (b as { platform: string }).platform).sort();
    expect(platforms).toEqual(["facebook", "instagram", "tiktok"]);
  });

  it("is idempotent — does nothing if all 3 banners already exist", async () => {
    const existing = ["tiktok", "instagram", "facebook"].map((platform, i) => ({
      id: `asset-${i}`,
      store_id: "store-1",
      type: "ad_banner",
      platform,
      brief_text: "x",
      image_url: `https://cdn.test/${platform}.png`,
    }));
    const generateImageBuffer = vi.fn(async () => Buffer.from("fake"));
    const { handler } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      initialBanners: existing,
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(generateImageBuffer).not.toHaveBeenCalled();
  });

  it("only regenerates the missing platform(s) — partial progress is preserved on retry", async () => {
    const existing = [
      {
        id: "asset-0",
        store_id: "store-1",
        type: "ad_banner",
        platform: "tiktok",
        brief_text: "x",
        image_url: "https://cdn.test/tiktok.png",
      },
    ];
    const generateImageBuffer = vi.fn(async () => Buffer.from("fake"));
    const { handler, supabase } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      initialBanners: existing,
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(generateImageBuffer).toHaveBeenCalledTimes(2);
    expect(supabase.__banners()).toHaveLength(3);
  });

  it("persists the banners that succeed even when a sibling fails fast (Promise.allSettled, not Promise.all)", async () => {
    // Regression test for a bug found in production: facebook's OpenAI call
    // rejected almost instantly (a rate limit), and with Promise.all that
    // aborted the whole batch before tiktok/instagram — which take longer
    // to "generate" — had a chance to finish and self-persist. Nothing got
    // saved even though 2 of 3 would have succeeded given the chance.
    const generateImageBuffer = vi.fn(async (prompt: string) => {
      if (prompt === "facebook banner") {
        throw new Error("429 status code (no body)");
      }
      return Buffer.from("fake-png-bytes");
    });
    const { handler, supabase } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await handler(request({ storeId: "store-1" }));
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("facebook");

    const savedPlatforms = supabase.__banners().map((b) => (b as { platform: string }).platform).sort();
    expect(savedPlatforms).toEqual(["instagram", "tiktok"]);
  });

  it("recovers cleanly when a concurrent trigger wins the insert race (23505) for one platform", async () => {
    const { handler, supabase } = await loadHandlerWithMocks({
      brand: { creative_brief: BRIEF },
      conflictingPlatforms: ["facebook"],
    });

    const res = await handler(request({ storeId: "store-1" }));

    expect(res.status).toBe(200);
    expect(supabase.__banners()).toHaveLength(2);
  });
});
