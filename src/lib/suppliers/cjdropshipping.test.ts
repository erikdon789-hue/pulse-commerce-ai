import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Token state is a module-level singleton (mirrors the real CJ SDK pattern
// of one cached token per process) — reset the module between tests so
// caching behavior can be tested deterministically instead of leaking
// across tests.
async function freshProvider() {
  vi.resetModules();
  const { createCjDropshippingProvider } = await import("./cjdropshipping");
  return createCjDropshippingProvider();
}

const TOKEN_RESPONSE = {
  code: 200,
  result: true,
  message: "Success",
  data: {
    accessToken: "test-access-token",
    accessTokenExpiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    refreshToken: "test-refresh-token",
    refreshTokenExpiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  },
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubEnv("CJ_DROPSHIPPING_API_KEY", "test-api-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("createCjDropshippingProvider", () => {
  it("isConfigured() reflects CJ_DROPSHIPPING_API_KEY presence", async () => {
    const provider = await freshProvider();
    expect(provider.isConfigured()).toBe(true);

    vi.stubEnv("CJ_DROPSHIPPING_API_KEY", "");
    const unconfigured = await freshProvider();
    expect(unconfigured.isConfigured()).toBe(false);
  });

  it("search() throws a clear error when not configured", async () => {
    vi.stubEnv("CJ_DROPSHIPPING_API_KEY", "");
    const provider = await freshProvider();
    await expect(provider.search({ keyword: "mug" })).rejects.toThrow(/not configured/);
  });

  it("fetches a token then searches, normalizing the listV2 response", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      if (url.includes("listV2")) {
        return jsonResponse({
          code: 200,
          data: {
            totalRecords: 1,
            totalPages: 1,
            content: [
              {
                productList: [
                  {
                    id: "abc-123",
                    nameEn: "Ceramic Coffee Mug",
                    sku: "CJMUG001",
                    bigImage: "https://cj.example/mug.jpg",
                    sellPrice: "9.50",
                    oneCategoryName: "Home",
                    threeCategoryName: "Mugs",
                  },
                ],
              },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    const result = await provider.search({ keyword: "mug", page: 1, pageSize: 10 });

    expect(result.totalRecords).toBe(1);
    expect(result.products).toEqual([
      {
        supplier: "cjdropshipping",
        supplierProductId: "abc-123",
        title: "Ceramic Coffee Mug",
        description: null,
        images: ["https://cj.example/mug.jpg"],
        price: { amount: 9.5, currency: "USD" },
        priceRange: null,
        minOrderQuantity: null,
        sourceUrl: null,
        category: "Home / Mugs",
        raw: expect.objectContaining({ id: "abc-123" }),
      },
    ]);

    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("getAccessToken"));
    expect(authCalls).toHaveLength(1);
  });

  it("splits a variant price range into price (min) + priceRange instead of producing NaN", async () => {
    // Regression test: CJ's live API returns sellPrice as a range string
    // ("22.25 -- 22.30" from listV2, "2.13-7.21" from product/query) for
    // products with variant-level pricing, not just a plain decimal —
    // confirmed against the real API, not documented anywhere.
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      return jsonResponse({
        code: 200,
        data: {
          totalRecords: 2,
          totalPages: 1,
          content: [
            {
              productList: [
                {
                  id: "range-spaced",
                  nameEn: "Wireless Earbuds",
                  sku: "SKU1",
                  bigImage: "",
                  sellPrice: "22.25 -- 22.30",
                  oneCategoryName: "",
                  threeCategoryName: "",
                },
                {
                  id: "range-tight",
                  nameEn: "Snap Phone Case",
                  sku: "SKU2",
                  bigImage: "",
                  sellPrice: "2.13-7.21",
                  oneCategoryName: "",
                  threeCategoryName: "",
                },
              ],
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    const result = await provider.search({ keyword: "x" });

    expect(result.products[0].price).toEqual({ amount: 22.25, currency: "USD" });
    expect(result.products[0].priceRange).toEqual({
      min: { amount: 22.25, currency: "USD" },
      max: { amount: 22.3, currency: "USD" },
    });
    expect(result.products[1].price).toEqual({ amount: 2.13, currency: "USD" });
    expect(result.products[1].priceRange).toEqual({
      min: { amount: 2.13, currency: "USD" },
      max: { amount: 7.21, currency: "USD" },
    });
    expect(Number.isNaN(result.products[0].price.amount)).toBe(false);
  });

  it("reuses the cached token across searches instead of re-authenticating", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      return jsonResponse({ code: 200, data: { totalRecords: 0, totalPages: 0, content: [] } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    await provider.search({ keyword: "a" });
    await provider.search({ keyword: "b" });

    const authCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("getAccessToken"));
    expect(authCalls).toHaveLength(1);
  });

  it("getProduct() returns null when CJ reports no data for the id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      return jsonResponse({ code: 200, data: null });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    const product = await provider.getProduct("does-not-exist");
    expect(product).toBeNull();
  });

  it("getProduct() normalizes a product detail response", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      return jsonResponse({
        code: 200,
        data: {
          pid: "abc-123",
          productNameEn: "Ceramic Coffee Mug",
          productSku: "CJMUG001",
          bigImage: "https://cj.example/mug.jpg",
          sellPrice: "9.5",
          categoryName: "Home / Mugs",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    const product = await provider.getProduct("abc-123");
    expect(product?.title).toBe("Ceramic Coffee Mug");
    expect(product?.price).toEqual({ amount: 9.5, currency: "USD" });
  });

  it("throws with the response message when the search request fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("getAccessToken")) return jsonResponse(TOKEN_RESPONSE);
      return jsonResponse({ code: 500, message: "internal error" }, 500);
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await freshProvider();
    await expect(provider.search({ keyword: "mug" })).rejects.toThrow(/internal error/);
  });
});
