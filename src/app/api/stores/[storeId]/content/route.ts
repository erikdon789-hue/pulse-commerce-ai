import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { productContentSchema } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { calculateSellingPrice } from "@/lib/pricing/calculate";

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
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
      return apiError(
        "PIPELINE_STEP_MISSING",
        "Run the ingest, analyze, and brand steps first",
        { status: 400 },
      );
    }

    // When we know the product's real cost, price is decided by the rules
    // engine, not the model — the AI is told the fixed price and only
    // writes copy/compare-at framing around it. Without a known cost (e.g.
    // a URL-scraped product with no parsed price), fall back to letting the
    // AI propose a price as before.
    const pricing =
      product.price_cents != null ? calculateSellingPrice({ baseCostCents: product.price_cents }) : null;

    try {
      const content = await generateStructured({
        schema: productContentSchema,
        schemaName: "product_content",
        instructions:
          "You are an e-commerce copywriter. Given a product, its brand voice, and " +
          "positioning, write a compelling product title and description (in the brand's " +
          "tone), 4-6 concrete benefits, 4-6 FAQs, 3-5 realistic placeholder customer " +
          "reviews, a pricing strategy, and 2-3 relevant upsell product ideas. " +
          (pricing
            ? "The selling price is already fixed at fixed_price_cents (calculated by a " +
              "deterministic pricing engine) — use that exact number as " +
              "suggested_price_cents, do not propose a different one. You may still " +
              "propose an optional higher compare_at_price_cents for perceived-discount " +
              "framing, and write reasoning that's consistent with the fixed price."
            : "Propose a suggested price and optional compare-at price (both in cents), " +
              "reasoned from the product's cost and market."),
        input: JSON.stringify({
          title: product.title,
          description: product.description,
          price_cents: product.price_cents,
          currency: product.currency,
          brand_name: brand.brand_name,
          tone_of_voice: brand.tone_of_voice,
          positioning: analysis.positioning,
          target_audience: analysis.target_audience,
          ...(pricing ? { fixed_price_cents: pricing.priceCents } : {}),
        }),
      });

      const pricingStrategy = pricing
        ? {
            suggested_price_cents: pricing.priceCents,
            // A "compare at" price only makes sense if it's actually higher
            // than the real price — drop a nonsensical or missing one
            // rather than show a broken discount.
            compare_at_price_cents:
              content.pricing_strategy.compare_at_price_cents != null &&
              content.pricing_strategy.compare_at_price_cents > pricing.priceCents
                ? content.pricing_strategy.compare_at_price_cents
                : null,
            reasoning:
              `Calculated via pricing rules: cost $${(pricing.costCents / 100).toFixed(2)} × ` +
              `${pricing.tierMultiplier} tier multiplier = $${(pricing.rawPriceCents / 100).toFixed(2)}, ` +
              `rounded to psychological pricing.` +
              (pricing.flooredByMinimumProfit
                ? ` Minimum-profit floor applied (tier price was below cost + minimum margin).`
                : ""),
          }
        : content.pricing_strategy;

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
            pricing_strategy: pricingStrategy,
            upsells: content.upsells,
          },
          { onConflict: "store_product_id" },
        )
        .select()
        .single();

      if (error) throw error;

      await markStepComplete(supabase, store.id, "content");

      return apiSuccess({ content: saved });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Content generation failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
