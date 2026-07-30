// Thin fetch-based wrapper around the Shopify Admin GraphQL API.
//
// We deliberately don't use @shopify/shopify-api here: that SDK bundles a
// full app-lifecycle framework (webhook registration, session storage,
// embedded-app helpers) this app doesn't need. This file only cares about a
// resolved shop domain + access token — it's OAuth-agnostic by design. OAuth
// itself (authorize/callback, HMAC verification, token exchange) lives in
// ./oauth.ts.

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";

export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    public readonly errors?: unknown,
  ) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

export function createShopifyAdminClient(shopDomain: string, accessToken: string) {
  const endpoint = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  async function request<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = await response.json();

    if (!response.ok || json.errors) {
      throw new ShopifyAdminError(
        json.errors?.[0]?.message ??
          `Shopify Admin API request failed (${response.status})`,
        json.errors,
      );
    }

    const userErrors = findUserErrors(json.data);
    if (userErrors.length > 0) {
      throw new ShopifyAdminError(userErrors.map((e) => e.message).join("; "), userErrors);
    }

    return json.data as T;
  }

  return { request, shopDomain, accessToken };
}

// Most Admin API mutations return a `userErrors: [{field, message}]` array
// on success (HTTP 200) instead of raising a GraphQL error, so we surface
// those uniformly through ShopifyAdminError as well.
function findUserErrors(data: unknown): { field?: string[]; message: string }[] {
  if (!data || typeof data !== "object") return [];
  return Object.values(data as Record<string, unknown>).flatMap((value) => {
    if (
      value &&
      typeof value === "object" &&
      "userErrors" in value &&
      Array.isArray((value as { userErrors: unknown }).userErrors)
    ) {
      return (value as { userErrors: { field?: string[]; message: string }[] }).userErrors;
    }
    return [];
  });
}

export type ShopifyAdminClient = ReturnType<typeof createShopifyAdminClient>;

export async function verifyShopifyCredentials(shopDomain: string, accessToken: string) {
  const client = createShopifyAdminClient(shopDomain, accessToken);
  const data = await client.request<{
    shop: { name: string; myshopifyDomain: string; email: string };
  }>(`query VerifyCredentials { shop { name myshopifyDomain email } }`);
  return data.shop;
}

export interface CreateProductInput {
  title: string;
  descriptionHtml: string;
  priceAmount: number;
  currencyCode: string;
  images: string[];
  tags?: string[];
}

export async function createShopifyProduct(
  client: ShopifyAdminClient,
  input: CreateProductInput,
) {
  const productData = await client.request<{
    productCreate: { product: { id: string; handle: string } };
  }>(
    `mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id handle }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        tags: input.tags ?? [],
      },
    },
  );

  const productId = productData.productCreate.product.id;

  await client.request(
    `mutation SetVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    {
      productId,
      variants: [{ price: input.priceAmount.toFixed(2) }],
    },
  );

  if (input.images.length > 0) {
    await client.request(
      `mutation AddProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          mediaUserErrors { field message }
        }
      }`,
      {
        productId,
        media: input.images.map((src) => ({
          originalSource: src,
          mediaContentType: "IMAGE",
        })),
      },
    );
  }

  return productData.productCreate.product;
}

export async function createShopifyCollection(
  client: ShopifyAdminClient,
  { title, descriptionHtml }: { title: string; descriptionHtml: string },
) {
  const data = await client.request<{
    collectionCreate: { collection: { id: string; handle: string } };
  }>(
    `mutation CreateCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle }
        userErrors { field message }
      }
    }`,
    { input: { title, descriptionHtml } },
  );
  return data.collectionCreate.collection;
}

export async function createShopifyPage(
  client: ShopifyAdminClient,
  { title, body }: { title: string; body: string },
) {
  const data = await client.request<{
    pageCreate: { page: { id: string; handle: string } };
  }>(
    `mutation CreatePage($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page { id handle }
        userErrors { field message }
      }
    }`,
    { page: { title, body } },
  );
  return data.pageCreate.page;
}
