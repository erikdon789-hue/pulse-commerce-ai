import { describe, it, expect, vi, afterEach } from "vitest";
import { createShopifyAdminClient, createShopifyProduct } from "./client";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createShopifyProduct", () => {
  // Regression test: a live push against the real Shopify Admin API failed
  // with "Product variant is missing ID attribute" — productCreate returns
  // a product with one auto-created default variant, but
  // productVariantsBulkUpdate is an UPDATE mutation and requires that
  // variant's id in its input, which the code wasn't fetching or sending.
  it("passes the default variant's id when setting its price, not just the price", async () => {
    const requests: { query: string; variables: unknown }[] = [];

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { query, variables } = JSON.parse(init.body as string);
      requests.push({ query, variables });

      if (query.includes("productCreate")) {
        return jsonResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/1",
                handle: "test-product",
                variants: { nodes: [{ id: "gid://shopify/ProductVariant/99" }] },
              },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes("productVariantsBulkUpdate")) {
        return jsonResponse({ data: { productVariantsBulkUpdate: { userErrors: [] } } });
      }
      // No images in this test, so productCreateMedia shouldn't be called.
      throw new Error(`unexpected query: ${query}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createShopifyAdminClient("test-shop.myshopify.com", "tok");
    await createShopifyProduct(client, {
      title: "Test Product",
      descriptionHtml: "<p>desc</p>",
      priceAmount: 60.99,
      currencyCode: "USD",
      images: [],
    });

    const variantUpdateCall = requests.find((r) => r.query.includes("productVariantsBulkUpdate"));
    expect(variantUpdateCall).toBeDefined();
    const variantsInput = (variantUpdateCall!.variables as { variants: { id: string; price: string }[] }).variants;
    expect(variantsInput).toEqual([{ id: "gid://shopify/ProductVariant/99", price: "60.99" }]);
  });

  it("throws a clear error if Shopify returns no default variant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: {
            productCreate: {
              product: { id: "gid://shopify/Product/1", handle: "test-product", variants: { nodes: [] } },
              userErrors: [],
            },
          },
        }),
      ),
    );

    const client = createShopifyAdminClient("test-shop.myshopify.com", "tok");
    await expect(
      createShopifyProduct(client, {
        title: "Test Product",
        descriptionHtml: "<p>desc</p>",
        priceAmount: 10,
        currencyCode: "USD",
        images: [],
      }),
    ).rejects.toThrow(/default variant/);
  });
});
