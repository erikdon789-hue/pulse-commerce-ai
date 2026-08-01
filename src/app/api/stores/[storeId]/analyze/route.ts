import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { productAnalysisSchema } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
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

    if (!product) {
      return apiError(
        "PIPELINE_STEP_MISSING",
        "Run the ingest step first — no product found for this store",
        { status: 400 },
      );
    }

    try {
      const analysis = await generateStructured({
        schema: productAnalysisSchema,
        schemaName: "product_analysis",
        instructions:
          "You are an e-commerce market analyst. Given a product, score its dropshipping/ " +
          "independent-store viability from 0-100, identify the target audience, likely " +
          "competitors, a positioning statement, and concrete marketing angles. Be specific " +
          "and realistic, not generic.",
        input: JSON.stringify({
          title: product.title,
          description: product.description,
          price_cents: product.price_cents,
          currency: product.currency,
          source_url: product.source_url,
        }),
      });

      const { data: saved, error } = await supabase
        .from("product_analysis")
        .upsert(
          {
            store_id: store.id,
            viability_score: analysis.viability_score,
            viability_reasoning: analysis.viability_reasoning,
            target_audience: analysis.target_audience,
            competitors: analysis.competitors,
            positioning: analysis.positioning,
            marketing_angles: analysis.marketing_angles,
          },
          { onConflict: "store_id" },
        )
        .select()
        .single();

      if (error) throw error;

      await markStepComplete(supabase, store.id, "analyze");

      return apiSuccess({ analysis: saved });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }
      const message = err instanceof Error ? err.message : "Analysis failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
