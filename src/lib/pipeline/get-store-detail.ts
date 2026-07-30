import type { createClient } from "@/lib/supabase/server";
import type { Store } from "@/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getStoreDetail(supabase: SupabaseServerClient, store: Store) {
  const storeId = store.id;

  const [
    { data: storeProducts },
    { data: analysis },
    { data: brand },
    { data: creativeAssets },
    { data: marketingContent },
    { data: buildJobs },
  ] = await Promise.all([
    supabase.from("store_products").select("*").eq("store_id", storeId),
    supabase.from("product_analysis").select("*").eq("store_id", storeId).maybeSingle(),
    supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
    supabase.from("creative_assets").select("*").eq("store_id", storeId),
    supabase.from("marketing_content").select("*").eq("store_id", storeId),
    supabase
      .from("build_jobs")
      .select("*")
      .eq("store_id", storeId)
      .order("started_at", { ascending: false })
      .limit(1),
  ]);

  const primaryProduct = storeProducts?.[0] ?? null;

  let content = null;
  let seo = null;
  if (primaryProduct) {
    const [{ data: productContent }, { data: seoContent }] = await Promise.all([
      supabase
        .from("product_content")
        .select("*")
        .eq("store_product_id", primaryProduct.id)
        .maybeSingle(),
      supabase
        .from("seo_content")
        .select("*")
        .eq("store_product_id", primaryProduct.id)
        .maybeSingle(),
    ]);
    content = productContent;
    seo = seoContent;
  }

  return {
    store,
    product: primaryProduct,
    analysis: analysis ?? null,
    brand: brand ?? null,
    creativeAssets: creativeAssets ?? [],
    content,
    seo,
    marketingContent: marketingContent ?? [],
    buildJob: buildJobs?.[0] ?? null,
  };
}

export type StoreDetail = Awaited<ReturnType<typeof getStoreDetail>>;
