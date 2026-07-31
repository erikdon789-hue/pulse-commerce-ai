import type {
  NormalizedProduct,
  SupplierProvider,
  SupplierSearchQuery,
  SupplierSearchResult,
} from "./types";

// NOT YET IMPLEMENTED.
//
// Alibaba.com Open Platform's API reference (openapi.alibaba.com/doc/api.htm)
// is a JS-rendered page gated behind an approved developer login — it could
// not be fetched to confirm the actual product-search method name, business
// params, or response shape while building this. Guessing a plausible-looking
// method name would risk shipping a client that looks real but is silently
// wrong, which is worse than not shipping it.
//
// Alibaba.com Open Platform is documented to share the same TOP-style
// gateway family as AliExpress (see ./top-signing.ts, reused here), so once
// real credentials and authenticated doc access are available, wiring this
// up should mean: confirm the method name, fill in search()/getProduct()
// following the same pattern as ./aliexpress.ts.
export function createAlibabaProvider(): SupplierProvider {
  function credentials() {
    const appKey = process.env.ALIBABA_APP_KEY;
    const appSecret = process.env.ALIBABA_APP_SECRET;
    if (!appKey || !appSecret) return null;
    return { appKey, appSecret };
  }

  const notImplemented = () => {
    throw new Error(
      "Alibaba provider is scaffolded but not implemented — its API method name couldn't be verified from public docs (see top-of-file comment in src/lib/suppliers/alibaba.ts)",
    );
  };

  return {
    id: "alibaba",

    isConfigured() {
      return credentials() !== null;
    },

    async search(_query: SupplierSearchQuery): Promise<SupplierSearchResult> {
      return notImplemented();
    },

    async getProduct(_supplierProductId: string): Promise<NormalizedProduct | null> {
      return notImplemented();
    },
  };
}
