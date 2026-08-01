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
// correctness: (1) creative_assets as a real, growing table so the
// idempotent short-circuit can be observed, and (2) the partial unique
// indexes from 0006_creative_brief_split.sql, simulated by rejecting a
// second insert with Postgres's 23505 when `insertShouldConflict` is set.
function fakeSupabase(opts: {
  brand: Row | null;
  initialAssets?: Row[];
  insertShouldConflict?: boolean;
}) {
  let assets: Row[] = opts.initialAssets ? [...opts.initialAssets] : [];
  const brandUpdates: Row[] = [];

  function makeChain(table: string) {
    let pendingInsert: Row[] | null = null;
    let pendingUpdate: Row | null = null;
    let selecting = false;

    const chain = {
      select: () => {
        selecting = true;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      insert: (payload: Row[]) => {
        pendingInsert = payload;
        return chain;
      },
      update: (payload: Row) => {
        pendingUpdate = payload;
        return chain;
      },
      maybeSingle: async () => {
        if (table === "brand_identity") return { data: opts.brand, error: null };
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === "brand_identity" && pendingUpdate) {
          brandUpdates.push(pendingUpdate);
          resolve({ data: null, error: null });
          return;
        }
        if (table === "creative_assets" && pendingInsert) {
          if (opts.insertShouldConflict) {
            resolve({
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            });
            return;
          }
          const inserted = pendingInsert.map((row, i) => ({ id: `asset-${assets.length + i}`, ...row }));
          assets = [...assets, ...inserted];
          resolve({ data: inserted, error: null });
          return;
        }
        if (table === "creative_assets" && selecting) {
          resolve({ data: assets, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return {
    from: (table: string) => makeChain(table),
    __assets: () => assets,
    __brandUpdates: brandUpdates,
  };
}

async function loadRouteWithMocks(opts: {
  brand: Row | null;
  initialAssets?: Row[];
  insertShouldConflict?: boolean;
  generateImageBufferMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const generateImageBuffer =
    opts.generateImageBufferMock ?? vi.fn(async () => Buffer.from("fake-png-bytes"));
  const uploadGeneratedImage = vi.fn(async (path: string) => `https://cdn.test/${path}`);

  const supabase = fakeSupabase({
    brand: opts.brand,
    initialAssets: opts.initialAssets,
    insertShouldConflict: opts.insertShouldConflict,
  });

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));
  vi.doMock("@/lib/ai/images", () => ({ generateImageBuffer }));
  vi.doMock("@/lib/supabase/storage", () => ({ uploadGeneratedImage }));

  const { POST } = await import("./route");
  return { POST, supabase, generateImageBuffer, uploadGeneratedImage };
}

describe("POST /api/stores/[storeId]/creative", () => {
  it("requires the creative brief step to have run first", async () => {
    const { POST } = await loadRouteWithMocks({ brand: { creative_brief: null } });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("PIPELINE_STEP_MISSING");
  });

  it("generates and saves all 4 assets (logo + 3 banners) from the persisted brief", async () => {
    const { POST, supabase, generateImageBuffer } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(generateImageBuffer).toHaveBeenCalledTimes(4);
    expect(body.data.creativeAssets).toHaveLength(4);
    expect(supabase.__assets()).toHaveLength(4);
    expect(supabase.__brandUpdates[0]?.logo_url).toMatch(/^https:\/\/cdn\.test\/store-1\/logo-/);
  });

  it("is idempotent — a retry after assets already exist does not call OpenAI again", async () => {
    const existing = [
      { id: "asset-0", store_id: "store-1", type: "logo", platform: null, brief_text: "x", image_url: "https://cdn.test/logo.png" },
    ];
    const generateImageBuffer = vi.fn(async () => Buffer.from("fake"));
    const { POST } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
      initialAssets: existing,
      generateImageBufferMock: generateImageBuffer,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.creativeAssets).toEqual(existing);
    expect(generateImageBuffer).not.toHaveBeenCalled();
  });

  it("recovers cleanly when a concurrent request wins the insert race (23505)", async () => {
    const { POST, supabase } = await loadRouteWithMocks({
      brand: { creative_brief: BRIEF },
      insertShouldConflict: true,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    // The conflicting insert never actually landed rows in our fake table,
    // but the important behavior is: no error bubbles to the client, and
    // it does not throw — it treats the conflict as "already created".
    expect(Array.isArray(body.data.creativeAssets)).toBe(true);
    expect(supabase.__assets()).toHaveLength(0);
  });
});
