import { NextResponse } from "next/server";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { productContentSchema } from "@/lib/ai/schemas";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const guard = await requireStoreOwner(storeId);
  if (guard.error) return guard.error;
  const { supabase, store } = guard;

  const [{ data: product }, { data: analysis }, { data: brand }] = await Promise.all([
    supabase
      .from("store_products")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("product_analysis").select("*").eq("store_id", storeId).maybeSingle(),
    supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
  ]);

  if (!product || !analysis || !brand) {
    return NextResponse.json(
      { error: "Run the ingest, analyze, and brand steps first" },
      { status: 400 },
    );
  }

  try {
    const content = await generateStructured({
      schema: productContentSchema,
      schemaName: "product_content",
      instructions:
        "You are an e-commerce copywriter. Given a product, its brand voice, and " +
        "positioning, write a compelling product title and description (in the brand's " +
        "tone), 4-6 concrete benefits, 4-6 FAQs, 3-5 realistic placeholder customer " +
        "reviews, a pricing strategy with a suggested price and optional compare-at " +
        "price (both in cents, reasoned from the product's cost and market), and 2-3 " +
        "relevant upsell product ideas.",
      input: JSON.stringify({
        title: product.title,
        description: product.description,
        price_cents: product.price_cents,
        currency: product.currency,
        brand_name: brand.brand_name,
        tone_of_voice: brand.tone_of_voice,
        positioning: analysis.positioning,
        target_audience: analysis.target_audience,
      }),
    });

    const { data: saved, error } = await supabase
      .from("product_content")
      .upsert(
        {
          store_product_id: product.id,
          title: content.title,
          description: content.description,
          benefits: content.benefits,
          faqs: content.faqs,
          review_placeholders: content.review_placeholders,
          pricing_strategy: content.pricing_strategy,
          upsells: content.upsells,
        },
        { onConflict: "store_product_id" },
      )
      .select()
      .single();

    if (error) throw error;

    await markStepComplete(supabase, store.id, "content");

    return NextResponse.json({ content: saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Content generation failed";
    await markJobFailed(supabase, store.id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
