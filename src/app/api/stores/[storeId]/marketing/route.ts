import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { marketingContentSchema } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

const PLATFORMS = ["tiktok", "instagram_reels", "facebook"] as const;

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const [{ data: brand }, { data: analysis }, { data: product }] = await Promise.all([
      supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
      supabase.from("product_analysis").select("*").eq("store_id", storeId).maybeSingle(),
      supabase
        .from("store_products")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!brand || !analysis || !product) {
      return apiError(
        "PIPELINE_STEP_MISSING",
        "Run the ingest, analyze, and brand steps first",
        { status: 400 },
      );
    }

    try {
      const sharedInput = {
        product_title: product.title,
        brand_name: brand.brand_name,
        tone_of_voice: brand.tone_of_voice,
        marketing_angles: analysis.marketing_angles,
        target_audience: analysis.target_audience,
      };

      const results = await Promise.all(
        PLATFORMS.map((platform) =>
          generateStructured({
            schema: marketingContentSchema,
            schemaName: `marketing_content_${platform}`,
            instructions:
              `You are a ${platform.replace("_", " ")} performance marketer. Given a ` +
              "product and brand, write 4-6 scroll-stopping hooks, 2-3 short video " +
              "scripts (hook/body/CTA structure), 3-5 caption variants, and 2-3 static " +
              "banner ad copy lines. Match the platform's native style and length norms.",
            input: JSON.stringify(sharedInput),
          }).then((data) => ({ platform, data })),
        ),
      );

      const rows = results.map(({ platform, data }) => ({
        store_id: store.id,
        platform,
        hooks: data.hooks,
        scripts: data.scripts,
        captions: data.captions,
        banner_copy: data.banner_copy,
      }));

      const { data: saved, error } = await supabase
        .from("marketing_content")
        .upsert(rows, { onConflict: "store_id,platform" })
        .select();

      if (error) throw error;

      await supabase.from("stores").update({ status: "ready" }).eq("id", store.id);
      await markStepComplete(supabase, store.id, "marketing");

      const { data: job } = await supabase
        .from("build_jobs")
        .select("*")
        .eq("store_id", store.id)
        .in("status", ["pending", "running"])
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (job) {
        await supabase
          .from("build_jobs")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", job.id);
      }

      return apiSuccess({ marketingContent: saved });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }
      const message = err instanceof Error ? err.message : "Marketing content generation failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
