import { describe, it, expect, vi } from "vitest";

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

type Row = Record<string, unknown>;

function fakeSupabase(opts: {
  brand: Row | null;
  existingBanners?: Row[];
  jobStatus?: string;
  jobError?: string;
}) {
  function makeChain(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === "brand_identity") return { data: opts.brand, error: null };
        if (table === "build_jobs") {
          return {
            data: opts.jobStatus ? { status: opts.jobStatus, error: opts.jobError ?? null } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === "creative_assets") {
          resolve({ data: opts.existingBanners ?? [], error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) };
}

async function loadRouteWithMocks(opts: {
  brand: Row | null;
  existingBanners?: Row[];
  jobStatus?: string;
  jobError?: string;
  triggerMock?: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const trigger = opts.triggerMock ?? vi.fn(async () => undefined);
  const supabase = fakeSupabase(opts);

  vi.doMock("@/lib/pipeline/guard", () => ({
    requireStoreOwner: vi.fn(async () => ({ supabase, store: FAKE_STORE })),
  }));
  vi.doMock("@/lib/pipeline/trigger-background", () => ({ triggerBackgroundFunction: trigger }));

  const { POST, GET } = await import("./route");
  return { POST, GET, trigger };
}

const ALL_THREE = ["tiktok", "instagram", "facebook"].map((platform, i) => ({
  id: `asset-${i}`,
  platform,
  type: "ad_banner",
  image_url: `https://cdn.test/${platform}.png`,
}));

describe("POST /api/stores/[storeId]/creative_banners", () => {
  it("requires the creative brief step to have run first", async () => {
    const { POST } = await loadRouteWithMocks({ brand: { creative_brief: null } });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("PIPELINE_STEP_MISSING");
  });

  it("is idempotent — returns existing banners without triggering when all 3 platforms are present", async () => {
    const { POST, trigger } = await loadRouteWithMocks({
      brand: { creative_brief: {} },
      existingBanners: ALL_THREE,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("done");
    expect(body.data.bannerAssets).toHaveLength(3);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("triggers the background function when any platform is missing", async () => {
    const { POST, trigger } = await loadRouteWithMocks({
      brand: { creative_brief: {} },
      existingBanners: [ALL_THREE[0]],
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("started");
    expect(trigger).toHaveBeenCalledWith(expect.anything(), "creative-banners-background", {
      storeId: "store-1",
    });
  });
});

describe("GET /api/stores/[storeId]/creative_banners", () => {
  it("reports done only when all 3 platforms are persisted", async () => {
    const { GET } = await loadRouteWithMocks({ brand: {}, existingBanners: [ALL_THREE[0], ALL_THREE[1]] });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("pending");
  });

  it("reports done when all 3 are present", async () => {
    const { GET } = await loadRouteWithMocks({ brand: {}, existingBanners: ALL_THREE });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("done");
    expect(body.data.bannerAssets).toHaveLength(3);
  });

  it("reports failed with the error message when the build job failed", async () => {
    const { GET } = await loadRouteWithMocks({ brand: {}, jobStatus: "failed", jobError: "rate limited" });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("failed");
    expect(body.data.error).toBe("rate limited");
  });
});
