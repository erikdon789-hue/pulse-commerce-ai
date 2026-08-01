import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { creativeBriefsSchema, type CreativeBriefs } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

// First of what's now three pipeline steps replacing the original single
// "creative" step, split out so each piece individually finishes well under
// Netlify's ~30s proxy inactivity timeout (see
// src/app/api/stores/[storeId]/creative_logo/route.ts and .../creative_banners/
// for the other two, and their git history for the full incident writeup).
// This step only generates and persists the brief — image generation
// happens in creative_logo and creative_banners, which read the brief back
// from brand_identity.creative_brief.
const DEADLINE_MS = 25_000;

class CreativeBriefTimeoutError extends Error {}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      reject(new CreativeBriefTimeoutError("Creative brief generation did not finish within the time budget"));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

    // Idempotent: a retry (double-click, network retry) after this step
    // already succeeded returns the persisted brief instead of paying for
    // another OpenAI call.
    if (brand.creative_brief) {
      await markStepComplete(supabase, store.id, "creative_brief");
      return apiSuccess({ brief: brand.creative_brief as CreativeBriefs });
    }

    const startedAt = Date.now();
    const deadlineAt = startedAt + DEADLINE_MS;

    try {
      const briefs = await withDeadline(
        generateStructured({
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
        }),
        deadlineAt,
      );

      const { error: updateError } = await supabase
        .from("brand_identity")
        .update({ creative_brief: briefs })
        .eq("store_id", store.id);

      if (updateError) throw updateError;

      await markStepComplete(supabase, store.id, "creative_brief");

      console.log(`[creative-brief] store=${store.id} completed in ${Date.now() - startedAt}ms`);
      return apiSuccess({ brief: briefs });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }

      const isTimeout = err instanceof CreativeBriefTimeoutError;
      const message = err instanceof Error ? err.message : "Creative brief generation failed";
      console.error(
        `[creative-brief] store=${store.id} failed after ${Date.now() - startedAt}ms:`,
        message,
      );
      await markJobFailed(supabase, store.id, message);

      if (isTimeout) {
        return apiError(
          "AI_GENERATION_TIMEOUT",
          "Creative brief generation is taking longer than usual. Please try again.",
          { status: 504 },
        );
      }
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
