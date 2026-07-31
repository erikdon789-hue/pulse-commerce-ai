// The normalized shape every supplier provider must translate its raw API
// response into, so the rest of the app (scoring, import, content
// generation — later phases) never needs to know which supplier a product
// came from.
export type SupplierId = "aliexpress" | "alibaba" | "cjdropshipping";

export interface SupplierMoney {
  amount: number;
  currency: string;
}

export interface NormalizedProduct {
  supplier: SupplierId;
  supplierProductId: string;
  title: string;
  description: string | null;
  images: string[];
  price: SupplierMoney;
  // B2B suppliers (Alibaba) commonly quote a price range tied to order
  // quantity tiers rather than one fixed price.
  priceRange: { min: SupplierMoney; max: SupplierMoney } | null;
  minOrderQuantity: number | null;
  sourceUrl: string | null;
  category: string | null;
  // The untouched provider payload — kept for audit/debugging, not for
  // display. Later phases (audit logs) will want this.
  raw: unknown;
}

export interface SupplierSearchQuery {
  keyword: string;
  page?: number;
  pageSize?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface SupplierSearchResult {
  supplier: SupplierId;
  products: NormalizedProduct[];
  page: number;
  pageSize: number;
  // Not every supplier API reports a total, so this stays nullable rather
  // than being faked as the current page's product count.
  totalRecords: number | null;
}

export interface SupplierProvider {
  id: SupplierId;
  // True only when this provider has real, usable credentials — the search
  // route uses this to decide which suppliers to query, and to tell the
  // caller which suppliers were skipped and why.
  isConfigured(): boolean;
  search(query: SupplierSearchQuery): Promise<SupplierSearchResult>;
  getProduct(supplierProductId: string): Promise<NormalizedProduct | null>;
}
