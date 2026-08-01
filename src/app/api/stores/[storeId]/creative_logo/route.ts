import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

// One of two routes replacing the old combined "creative" step (see
// src/app/api/stores/[storeId]/creative/route.ts's git history for the full
// incident — that route generated the logo + all 3 ad banners as 4
// concurrent OpenAI calls in a single request, which had enough production
// latency variance (24-33s+) that no fixed deadline reliably beat Netlify's
// ~30-34s proxy inactivity cutoff). This route generates only the logo — a
// single image call, comfortably lighter than the old 4-image batch — and
// src/app/api/stores/[storeId]/creative_banners/route.ts generates the 3 ad
// banners as its own separately-invoked step.
//
// DEADLINE_MS was 20s initially. A direct isolated OpenAI call measured
// 13.8s for this exact prompt shape at the same time production requests
// were hitting the 20s deadline at 21-21.5s total — confirming real
// end-to-end overhead (cold start, guard-check DB round trips, Netlify's
// network path to OpenAI) adds several seconds beyond the raw image call,
// same pattern seen tuning the old combined route. Raised to 24s, still
// well under the ~30-34s observed proxy ceiling.
const DEADLINE_MS = 24_000;

class CreativeLogoTimeoutError extends Error {}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      reject(new CreativeLogoTimeoutError("Logo generation did not finish within the time budget"));
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

    const [{ data: brand }, { data: existingLogo }] = await Promise.all([
      supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
      supabase
        .from("creative_assets")
        .select("*")
        .eq("store_id", storeId)
        .eq("type", "logo")
        .maybeSingle(),
    ]);

    if (!brand || !brand.creative_brief) {
      return apiError("PIPELINE_STEP_MISSING", "Run the creative brief step first", {
        status: 400,
      });
    }

    // Idempotent: a retry (double-click, network retry, or a request that
    // succeeded server-side but whose response the client missed) after
    // this step already ran returns the persisted logo instead of paying
    // for another OpenAI call.
    if (existingLogo) {
      await markStepComplete(supabase, store.id, "creative_logo");
      return apiSuccess({ logoAsset: existingLogo });
    }

    const briefs = brand.creative_brief as unknown as CreativeBriefs;
    const startedAt = Date.now();
    const deadlineAt = startedAt + DEADLINE_MS;

    try {
      const buffer = await withDeadline(
        generateImageBuffer(briefs.logo_image_prompt),
        deadlineAt,
      );
      const imageUrl = await uploadGeneratedImage(`${store.id}/logo-${Date.now()}.png`, buffer);
      console.log(`[creative_logo] store=${store.id} generated in ${Date.now() - startedAt}ms`);

      const { data: logoAsset, error } = await supabase
        .from("creative_assets")
        .insert({
          store_id: store.id,
          type: "logo",
          platform: null,
          brief_text: briefs.logo_brief,
          image_url: imageUrl,
        })
        .select()
        .single();

      if (error) {
        // A concurrent request already inserted the logo first — the
        // creative_assets_unique_logo partial index rejects the second
        // insert. Treat that as success and return what's actually there.
        if (error.code === "23505") {
          const { data: raceWinnerLogo } = await supabase
            .from("creative_assets")
            .select("*")
            .eq("store_id", store.id)
            .eq("type", "logo")
            .maybeSingle();
          await markStepComplete(supabase, store.id, "creative_logo");
          return apiSuccess({ logoAsset: raceWinnerLogo });
        }
        throw error;
      }

      await supabase
        .from("brand_identity")
        .update({ logo_url: imageUrl })
        .eq("store_id", store.id);

      await markStepComplete(supabase, store.id, "creative_logo");

      console.log(`[creative_logo] store=${store.id} completed in ${Date.now() - startedAt}ms`);
      return apiSuccess({ logoAsset });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }

      const isTimeout = err instanceof CreativeLogoTimeoutError;
      const message = err instanceof Error ? err.message : "Logo generation failed";
      console.error(
        `[creative_logo] store=${store.id} failed after ${Date.now() - startedAt}ms:`,
        message,
      );
      await markJobFailed(supabase, store.id, message);

      if (isTimeout) {
        return apiError(
          "AI_GENERATION_TIMEOUT",
          "Logo generation is taking longer than the platform allows right now. Please try again.",
          { status: 504 },
        );
      }
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
