import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { brandIdentitySchema } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const [{ data: product }, { data: analysis }] = await Promise.all([
      supabase
        .from("store_products")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("product_analysis").select("*").eq("store_id", storeId).maybeSingle(),
    ]);

    if (!product || !analysis) {
      return apiError("PIPELINE_STEP_MISSING", "Run the ingest and analyze steps first", {
        status: 400,
      });
    }

    try {
      const brand = await generateStructured({
        schema: brandIdentitySchema,
        schemaName: "brand_identity",
        instructions:
          "You are a brand strategist. Given a product, its positioning, and target " +
          "audience, invent a distinct, memorable brand: name, slogan, a 3-color palette " +
          "(hex codes), heading/body font pairing (real, commonly available font names), " +
          "and a tone of voice.",
        input: JSON.stringify({
          product_title: product.title,
          positioning: analysis.positioning,
          target_audience: analysis.target_audience,
          marketing_angles: analysis.marketing_angles,
        }),
      });

      const { data: saved, error } = await supabase
        .from("brand_identity")
        .upsert(
          {
            store_id: store.id,
            brand_name: brand.brand_name,
            slogan: brand.slogan,
            colors: brand.colors,
            fonts: brand.fonts,
            tone_of_voice: brand.tone_of_voice,
          },
          { onConflict: "store_id" },
        )
        .select()
        .single();

      if (error) throw error;

      await supabase.from("stores").update({ name: brand.brand_name }).eq("id", store.id);
      await markStepComplete(supabase, store.id, "brand");

      return apiSuccess({ brand: saved });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Brand generation failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
