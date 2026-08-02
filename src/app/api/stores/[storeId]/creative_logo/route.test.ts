import { describe, it, expect, vi } from "vitest";

const FAKE_STORE = { id: "store-1", owner_id: "user-1" };

type Row = Record<string, unknown>;

function fakeSupabase(opts: { brand: Row | null; existingLogo?: Row | null; jobStatus?: string; jobError?: string }) {
  function makeChain(table: string) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        if (table === "brand_identity") return { data: opts.brand, error: null };
        if (table === "creative_assets") return { data: opts.existingLogo ?? null, error: null };
        if (table === "build_jobs") {
          return {
            data: opts.jobStatus ? { status: opts.jobStatus, error: opts.jobError ?? null } : null,
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) };
}

async function loadRouteWithMocks(opts: {
  brand: Row | null;
  existingLogo?: Row | null;
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

  it("is idempotent — returns the existing logo without triggering the background job", async () => {
    const existingLogo = { id: "asset-0", image_url: "https://cdn.test/logo.png" };
    const { POST, trigger } = await loadRouteWithMocks({
      brand: { creative_brief: {} },
      existingLogo,
    });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("done");
    expect(body.data.logoAsset).toEqual(existingLogo);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("triggers the background function and returns started when nothing exists yet", async () => {
    const { POST, trigger } = await loadRouteWithMocks({ brand: { creative_brief: {} } });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("started");
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(expect.anything(), "creative-logo-background", {
      storeId: "store-1",
    });
  });

  it("surfaces a clean error if the background trigger itself fails", async () => {
    const trigger = vi.fn(async () => {
      throw new Error("Failed to trigger background function creative-logo-background: HTTP 401");
    });
    const { POST } = await loadRouteWithMocks({ brand: { creative_brief: {} }, triggerMock: trigger });

    const res = await POST(new Request("http://test", { method: "POST" }), {
      params: Promise.resolve({ storeId: "store-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("BACKGROUND_TRIGGER_FAILED");
  });
});

describe("GET /api/stores/[storeId]/creative_logo", () => {
  it("reports done when the logo is persisted", async () => {
    const existingLogo = { id: "asset-0", image_url: "https://cdn.test/logo.png" };
    const { GET } = await loadRouteWithMocks({ brand: {}, existingLogo });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("done");
    expect(body.data.logoAsset).toEqual(existingLogo);
  });

  it("reports pending when nothing is persisted and no job has failed", async () => {
    const { GET } = await loadRouteWithMocks({ brand: {} });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("pending");
  });

  it("reports failed with the error message when the build job failed", async () => {
    const { GET } = await loadRouteWithMocks({ brand: {}, jobStatus: "failed", jobError: "OpenAI is down" });

    const res = await GET(new Request("http://test"), { params: Promise.resolve({ storeId: "store-1" }) });
    const body = await res.json();

    expect(body.data.status).toBe("failed");
    expect(body.data.error).toBe("OpenAI is down");
  });
});
