import type {
  NormalizedProduct,
  SupplierProvider,
  SupplierSearchQuery,
  SupplierSearchResult,
} from "./types";
import { buildTopSystemParams, signTopRequest } from "./top-signing";

// UNVERIFIED. Scaffolded against AliExpress Open Platform's publicly
// documented gateway conventions (api-sg.aliexpress.com/sync) and the
// widely-used aliexpress.affiliate.product.query / .productdetail.get
// methods. AliExpress gates its full API reference behind an approved
// developer-console login, which wasn't accessible while building this, so
// the exact business-param names and response shape below could not be
// confirmed against the live docs — only against secondary sources
// (existing open-source API wrappers). Test against a real Open Platform
// app before trusting this in production; requires ALIEXPRESS_APP_KEY,
// ALIEXPRESS_APP_SECRET, and ALIEXPRESS_TRACKING_ID.
const GATEWAY_URL = "https://api-sg.aliexpress.com/sync";
const SEARCH_METHOD = "aliexpress.affiliate.product.query";
const DETAIL_METHOD = "aliexpress.affiliate.productdetail.get";

interface AliExpressProduct {
  product_id: string;
  product_title: string;
  product_main_image_url: string;
  target_sale_price: string;
  target_sale_price_currency: string;
  product_detail_url: string;
  first_level_category_name?: string;
}

interface AliExpressErrorResponse {
  error_response?: { code: string; msg: string };
}

interface AliExpressQueryResponse extends AliExpressErrorResponse {
  aliexpress_affiliate_product_query_response?: {
    resp_result?: {
      resp_code: number;
      resp_msg: string;
      result?: {
        current_page_no: number;
        total_record_count: number;
        products?: { product: AliExpressProduct[] };
      };
    };
  };
}

interface AliExpressDetailResponse extends AliExpressErrorResponse {
  aliexpress_affiliate_productdetail_get_response?: {
    resp_result?: {
      resp_code: number;
      resp_msg: string;
      result?: { products?: { product: AliExpressProduct[] } };
    };
  };
}

interface AliExpressCredentials {
  appKey: string;
  appSecret: string;
  trackingId: string;
}

function credentials(): AliExpressCredentials | null {
  const appKey = process.env.ALIEXPRESS_APP_KEY;
  const appSecret = process.env.ALIEXPRESS_APP_SECRET;
  const trackingId = process.env.ALIEXPRESS_TRACKING_ID;
  if (!appKey || !appSecret || !trackingId) return null;
  return { appKey, appSecret, trackingId };
}

function requireCredentials(): AliExpressCredentials {
  const creds = credentials();
  if (!creds) {
    throw new Error("AliExpress is not configured (missing ALIEXPRESS_APP_KEY/ALIEXPRESS_APP_SECRET/ALIEXPRESS_TRACKING_ID)");
  }
  return creds;
}

async function callTopApi<T extends AliExpressErrorResponse>(
  method: string,
  businessParams: Record<string, string>,
  creds: AliExpressCredentials,
): Promise<T> {
  const systemParams = buildTopSystemParams({ appKey: creds.appKey, method });
  const allParams = { ...systemParams, ...businessParams };
  const sign = signTopRequest(allParams, creds.appSecret);

  const url = new URL(GATEWAY_URL);
  for (const [key, value] of Object.entries({ ...allParams, sign })) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  const body: T = await response.json();
  if (!response.ok || body.error_response) {
    const err = body.error_response;
    throw new Error(`AliExpress API error${err ? ` ${err.code}: ${err.msg}` : ` (HTTP ${response.status})`}`);
  }
  return body;
}

function normalize(p: AliExpressProduct): NormalizedProduct {
  return {
    supplier: "aliexpress",
    supplierProductId: p.product_id,
    title: p.product_title,
    description: null,
    images: p.product_main_image_url ? [p.product_main_image_url] : [],
    price: {
      amount: Number(p.target_sale_price),
      currency: p.target_sale_price_currency || "USD",
    },
    priceRange: null,
    minOrderQuantity: null,
    sourceUrl: p.product_detail_url ?? null,
    category: p.first_level_category_name ?? null,
    raw: p,
  };
}

export function createAliExpressProvider(): SupplierProvider {
  return {
    id: "aliexpress",

    isConfigured() {
      return credentials() !== null;
    },

    async search(query: SupplierSearchQuery): Promise<SupplierSearchResult> {
      const creds = requireCredentials();

      const body = await callTopApi<AliExpressQueryResponse>(
        SEARCH_METHOD,
        {
          keywords: query.keyword,
          page_no: String(query.page ?? 1),
          page_size: String(Math.min(query.pageSize ?? 20, 50)),
          tracking_id: creds.trackingId,
          target_currency: "USD",
          target_language: "EN",
          ...(query.minPrice != null ? { min_sale_price: String(query.minPrice) } : {}),
          ...(query.maxPrice != null ? { max_sale_price: String(query.maxPrice) } : {}),
        },
        creds,
      );

      const result = body.aliexpress_affiliate_product_query_response?.resp_result?.result;
      if (!result) {
        throw new Error("AliExpress search returned an unexpected response shape");
      }

      return {
        supplier: "aliexpress",
        products: (result.products?.product ?? []).map(normalize),
        page: result.current_page_no,
        pageSize: query.pageSize ?? 20,
        totalRecords: result.total_record_count,
      };
    },

    async getProduct(supplierProductId: string): Promise<NormalizedProduct | null> {
      const creds = requireCredentials();

      const body = await callTopApi<AliExpressDetailResponse>(
        DETAIL_METHOD,
        {
          product_ids: supplierProductId,
          tracking_id: creds.trackingId,
          target_currency: "USD",
          target_language: "EN",
        },
        creds,
      );

      const product = body.aliexpress_affiliate_productdetail_get_response?.resp_result?.result?.products?.product?.[0];
      return product ? normalize(product) : null;
    },
  };
}
