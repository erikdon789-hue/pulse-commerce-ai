import type {
  NormalizedProduct,
  SupplierProvider,
  SupplierSearchQuery,
  SupplierSearchResult,
} from "./types";

// Built against CJdropshipping's official API v2 docs
// (developers.cjdropshipping.cn/en/api/api2/), verified 2026-07-31.
const BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

interface CjTokenState {
  accessToken: string;
  accessTokenExpiryDate: string;
  refreshToken: string;
  refreshTokenExpiryDate: string;
}

interface CjApiEnvelope<T> {
  code: number;
  result: boolean;
  message?: string;
  data: T | null;
}

interface CjListProduct {
  id: string;
  nameEn: string;
  sku: string;
  bigImage: string;
  sellPrice: string;
  oneCategoryName: string;
  threeCategoryName: string;
}

interface CjListV2Data {
  totalRecords: number;
  totalPages: number;
  content: Array<{ productList: CjListProduct[] }>;
}

interface CjProductDetail {
  pid: string;
  productNameEn: string;
  productSku: string;
  bigImage: string;
  sellPrice: number;
  categoryName: string;
}

// One CJ account's token, shared across requests in this process. A
// multi-instance deployment would need to move this to shared storage —
// not needed at this scale.
let tokenState: CjTokenState | null = null;
let tokenRequest: Promise<CjTokenState> | null = null;

async function requestAccessToken(apiKey: string): Promise<CjTokenState> {
  const response = await fetch(`${BASE_URL}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const body: CjApiEnvelope<CjTokenState> = await response.json();
  if (!response.ok || !body.result || !body.data) {
    throw new Error(`CJdropshipping auth failed (${response.status}): ${body.message ?? "unknown error"}`);
  }
  return body.data;
}

async function requestRefreshedToken(refreshToken: string): Promise<CjTokenState> {
  const response = await fetch(`${BASE_URL}/authentication/refreshAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const body: CjApiEnvelope<CjTokenState> = await response.json();
  if (!response.ok || !body.result || !body.data) {
    throw new Error(`CJdropshipping token refresh failed (${response.status}): ${body.message ?? "unknown error"}`);
  }
  return body.data;
}

const EXPIRY_SAFETY_MARGIN_MS = 60_000;

async function getValidAccessToken(apiKey: string): Promise<string> {
  const now = Date.now();

  if (tokenState && new Date(tokenState.accessTokenExpiryDate).getTime() - now > EXPIRY_SAFETY_MARGIN_MS) {
    return tokenState.accessToken;
  }

  // Collapse concurrent callers onto a single in-flight token request
  // instead of each firing its own (CJ's auth endpoint is rate-limited to
  // 1 request/second).
  if (!tokenRequest) {
    const current = tokenState;
    tokenRequest = (
      current && new Date(current.refreshTokenExpiryDate).getTime() - now > EXPIRY_SAFETY_MARGIN_MS
        ? requestRefreshedToken(current.refreshToken)
        : requestAccessToken(apiKey)
    ).finally(() => {
      tokenRequest = null;
    });
  }

  tokenState = await tokenRequest;
  return tokenState.accessToken;
}

function normalizeListProduct(p: CjListProduct): NormalizedProduct {
  return {
    supplier: "cjdropshipping",
    supplierProductId: p.id,
    title: p.nameEn,
    description: null,
    images: p.bigImage ? [p.bigImage] : [],
    price: { amount: Number(p.sellPrice), currency: "USD" },
    priceRange: null,
    minOrderQuantity: null,
    sourceUrl: null,
    category: [p.oneCategoryName, p.threeCategoryName].filter(Boolean).join(" / ") || null,
    raw: p,
  };
}

function normalizeDetail(p: CjProductDetail): NormalizedProduct {
  return {
    supplier: "cjdropshipping",
    supplierProductId: p.pid,
    title: p.productNameEn,
    description: null,
    images: p.bigImage ? [p.bigImage] : [],
    price: { amount: Number(p.sellPrice), currency: "USD" },
    priceRange: null,
    minOrderQuantity: null,
    sourceUrl: null,
    category: p.categoryName ?? null,
    raw: p,
  };
}

function requireApiKey(): string {
  const apiKey = process.env.CJ_DROPSHIPPING_API_KEY;
  if (!apiKey) throw new Error("CJdropshipping is not configured (missing CJ_DROPSHIPPING_API_KEY)");
  return apiKey;
}

export function createCjDropshippingProvider(): SupplierProvider {
  return {
    id: "cjdropshipping",

    isConfigured() {
      return Boolean(process.env.CJ_DROPSHIPPING_API_KEY);
    },

    async search(query: SupplierSearchQuery): Promise<SupplierSearchResult> {
      const apiKey = requireApiKey();
      const token = await getValidAccessToken(apiKey);

      const params = new URLSearchParams();
      params.set("page", String(query.page ?? 1));
      params.set("size", String(Math.min(query.pageSize ?? 20, 100)));
      params.set("keyWord", query.keyword);
      if (query.minPrice != null) params.set("startSellPrice", String(query.minPrice));
      if (query.maxPrice != null) params.set("endSellPrice", String(query.maxPrice));

      const response = await fetch(`${BASE_URL}/product/listV2?${params.toString()}`, {
        headers: { "CJ-Access-Token": token },
      });
      const body: CjApiEnvelope<CjListV2Data> = await response.json();
      if (!response.ok || body.code !== 200 || !body.data) {
        throw new Error(`CJdropshipping search failed (${response.status}): ${body.message ?? "unknown error"}`);
      }

      const products = body.data.content.flatMap((group) => group.productList.map(normalizeListProduct));

      return {
        supplier: "cjdropshipping",
        products,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
        totalRecords: body.data.totalRecords,
      };
    },

    async getProduct(supplierProductId: string): Promise<NormalizedProduct | null> {
      const apiKey = requireApiKey();
      const token = await getValidAccessToken(apiKey);

      const params = new URLSearchParams({ pid: supplierProductId });
      const response = await fetch(`${BASE_URL}/product/query?${params.toString()}`, {
        headers: { "CJ-Access-Token": token },
      });
      const body: CjApiEnvelope<CjProductDetail> = await response.json();

      if (!body.data) return null;
      if (!response.ok || body.code !== 200) {
        throw new Error(`CJdropshipping product fetch failed (${response.status}): ${body.message ?? "unknown error"}`);
      }

      return normalizeDetail(body.data);
    },
  };
}
