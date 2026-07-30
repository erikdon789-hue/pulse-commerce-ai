import type { Database } from "@/types/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Store = Database["public"]["Tables"]["stores"]["Row"];
export type StoreProduct = Database["public"]["Tables"]["store_products"]["Row"];
export type ProductAnalysisRow = Database["public"]["Tables"]["product_analysis"]["Row"];
export type BrandIdentityRow = Database["public"]["Tables"]["brand_identity"]["Row"];
export type CreativeAsset = Database["public"]["Tables"]["creative_assets"]["Row"];
export type ProductContentRow = Database["public"]["Tables"]["product_content"]["Row"];
export type SeoContentRow = Database["public"]["Tables"]["seo_content"]["Row"];
export type MarketingContentRow = Database["public"]["Tables"]["marketing_content"]["Row"];
export type ShopifyConnection = Database["public"]["Tables"]["shopify_connections"]["Row"];
export type BuildJob = Database["public"]["Tables"]["build_jobs"]["Row"];
export type CreditLedgerEntry = Database["public"]["Tables"]["credit_ledger"]["Row"];

export const PIPELINE_STEPS = [
  "ingest",
  "analyze",
  "brand",
  "creative",
  "content",
  "seo",
  "marketing",
  "shopify_connect",
  "shopify_push",
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];
