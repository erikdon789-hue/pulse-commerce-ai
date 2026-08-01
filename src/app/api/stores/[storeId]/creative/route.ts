import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import { creativeBriefsSchema } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const [{ data: brand }, { data: analysis }] = await Promise.all([
      supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
      supabase.from("product_analysis").select("*").eq("store_id", storeId).maybeSingle(),
    ]);

    if (!brand || !analysis) {
      return apiError("PIPELINE_STEP_MISSING", "Run the analyze and brand steps first", {
        status: 400,
      });
    }

    try {
      const briefs = await generateStructured({
        schema: creativeBriefsSchema,
        schemaName: "creative_briefs",
        instructions:
          "You are an art director. Given a brand identity, write a brief plus a " +
          "detailed image-generation prompt for a clean, modern logo mark, and one ad " +
          "banner brief + image-generation prompt each for TikTok, Instagram, and " +
          "Facebook, tailored to the brand's colors, tone, and marketing angles.",
        input: JSON.stringify({
          brand_name: brand.brand_name,
          slogan: brand.slogan,
          colors: brand.colors,
          fonts: brand.fonts,
          tone_of_voice: brand.tone_of_voice,
          marketing_angles: analysis.marketing_angles,
        }),
      });

      // Logo + all ad banners are independent OpenAI image calls — run them
      // concurrently instead of sequentially. Four sequential generations took
      // 2-4 minutes total, long enough to exceed proxy/tunnel and serverless
      // function timeouts (e.g. free Cloudflare quick tunnels cut connections
      // around ~100s) even though the endpoint itself completed successfully.
      const [logoResult, ...bannerResults] = await Promise.all([
        generateImageBuffer(briefs.logo_image_prompt).then(async (buffer) => ({
          imageUrl: await uploadGeneratedImage(`${store.id}/logo-${Date.now()}.png`, buffer),
        })),
        ...briefs.ad_banners.map((banner) =>
          generateImageBuffer(banner.image_prompt).then(async (buffer) => ({
            platform: banner.platform,
            brief: banner.brief,
            imageUrl: await uploadGeneratedImage(
              `${store.id}/ad-${banner.platform}-${Date.now()}.png`,
              buffer,
            ),
          })),
        ),
      ]);

      const logoUrl = logoResult.imageUrl;

      await supabase
        .from("brand_identity")
        .update({ logo_url: logoUrl })
        .eq("store_id", store.id);

      const assetRows: {
        store_id: string;
        type: "logo" | "ad_banner";
        platform: "tiktok" | "instagram" | "facebook" | null;
        brief_text: string;
        image_url: string;
      }[] = [
        {
          store_id: store.id,
          type: "logo",
          platform: null,
          brief_text: briefs.logo_brief,
          image_url: logoUrl,
        },
        ...bannerResults.map((banner) => ({
          store_id: store.id,
          type: "ad_banner" as const,
          platform: banner.platform,
          brief_text: banner.brief,
          image_url: banner.imageUrl,
        })),
      ];

      const { data: savedAssets, error } = await supabase
        .from("creative_assets")
        .insert(assetRows)
        .select();

      if (error) throw error;

      await markStepComplete(supabase, store.id, "creative");

      return apiSuccess({ creativeAssets: savedAssets });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }
      const message = err instanceof Error ? err.message : "Creative generation failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
