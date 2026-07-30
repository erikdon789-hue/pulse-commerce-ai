import { NextResponse } from "next/server";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { seoContentSchema } from "@/lib/ai/schemas";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const guard = await requireStoreOwner(storeId);
  if (guard.error) return guard.error;
  const { supabase, store } = guard;

  const { data: product } = await supabase
    .from("store_products")
    .select("*")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: productContent } = product
    ? await supabase
        .from("product_content")
        .select("*")
        .eq("store_product_id", product.id)
        .maybeSingle()
    : { data: null };

  if (!product || !productContent) {
    return NextResponse.json(
      { error: "Run the content step first" },
      { status: 400 },
    );
  }

  try {
    const seo = await generateStructured({
      schema: seoContentSchema,
      schemaName: "seo_content",
      instructions:
        "You are an SEO specialist. Given a product's title and description, write an " +
        "SEO title (under 60 chars), a meta description (under 160 chars), 8-12 " +
        "relevant keywords, and a collection title + description for the store's main " +
        "product collection page.",
      input: JSON.stringify({
        title: productContent.title,
        description: productContent.description,
        benefits: productContent.benefits,
      }),
    });

    const { data: saved, error } = await supabase
      .from("seo_content")
      .upsert(
        {
          store_product_id: product.id,
          seo_title: seo.seo_title,
          meta_description: seo.meta_description,
          keywords: seo.keywords,
        },
        { onConflict: "store_product_id" },
      )
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("stores")
      .update({
        collection_title: seo.collection_title,
        collection_description: seo.collection_description,
      })
      .eq("id", store.id);

    await markStepComplete(supabase, store.id, "seo");

    return NextResponse.json({
      seo: saved,
      collection_title: seo.collection_title,
      collection_description: seo.collection_description,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SEO generation failed";
    await markJobFailed(supabase, store.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
