import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import type { CreativeAsset } from "@/types";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

// Second of the two routes replacing the old combined "creative" step (see
// src/app/api/stores/[storeId]/creative_logo/route.ts for the full incident
// writeup and src/app/api/stores/[storeId]/creative/route.ts's git history).
// This route generates only the 3 ad banners — still 3 concurrent OpenAI
// calls, so it keeps the same deadline-racer safety net as the old route,
// but each banner is persisted to creative_assets the moment its own image
// finishes, not batched until all 3 complete. That matters here
// specifically: if the deadline fires after 2 of 3 succeeded, those 2 are
// already saved, and a retry only has to generate the missing one (checked
// per-platform below) instead of redoing all 3 from scratch.
const DEADLINE_MS = 24_000;

const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

class CreativeBannersTimeoutError extends Error {}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      reject(new CreativeBannersTimeoutError("Ad banner generation did not finish within the time budget"));
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

    const [{ data: brand }, { data: existingBanners }] = await Promise.all([
      supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
      supabase
        .from("creative_assets")
        .select("*")
        .eq("store_id", storeId)
        .eq("type", "ad_banner"),
    ]);

    if (!brand || !brand.creative_brief) {
      return apiError("PIPELINE_STEP_MISSING", "Run the creative brief step first", {
        status: 400,
      });
    }

    const existing = (existingBanners ?? []) as CreativeAsset[];
    const missingPlatforms = PLATFORMS.filter(
      (platform) => !existing.some((asset) => asset.platform === platform),
    );

    // Idempotent: only generate platforms that aren't already persisted. If
    // all 3 are already there (full success previously, or a retry racing
    // an in-flight request that's already finished), skip OpenAI entirely.
    if (missingPlatforms.length === 0) {
      await markStepComplete(supabase, store.id, "creative_banners");
      return apiSuccess({ bannerAssets: existing });
    }

    const briefs = brand.creative_brief as unknown as CreativeBriefs;
    const briefsToGenerate = briefs.ad_banners.filter((b) => missingPlatforms.includes(b.platform));
    const startedAt = Date.now();
    const deadlineAt = startedAt + DEADLINE_MS;

    try {
      const generated = await withDeadline(
        Promise.all(
          briefsToGenerate.map(async (banner) => {
            const buffer = await generateImageBuffer(banner.image_prompt).catch((err) => {
              throw new Error(
                `${banner.platform} ad banner image generation failed: ` +
                  `${err instanceof Error ? err.message : String(err)}`,
              );
            });
            const imageUrl = await uploadGeneratedImage(
              `${store.id}/ad-${banner.platform}-${Date.now()}.png`,
              buffer,
            );

            // Persisted the moment this one image is ready, not batched
            // with its siblings — see file header comment.
            const { data: saved, error } = await supabase
              .from("creative_assets")
              .insert({
                store_id: store.id,
                type: "ad_banner",
                platform: banner.platform,
                brief_text: banner.brief,
                image_url: imageUrl,
              })
              .select()
              .single();

            if (error) {
              // A concurrent request already inserted this exact platform
              // first — the creative_assets_unique_banner partial index
              // rejects the second insert. Treat that as success.
              if (error.code === "23505") {
                const { data: raceWinner } = await supabase
                  .from("creative_assets")
                  .select("*")
                  .eq("store_id", store.id)
                  .eq("type", "ad_banner")
                  .eq("platform", banner.platform)
                  .maybeSingle();
                return raceWinner as CreativeAsset;
              }
              throw error;
            }

            console.log(`[creative_banners] store=${store.id} ${banner.platform} done in ${Date.now() - startedAt}ms`);
            return saved as CreativeAsset;
          }),
        ),
        deadlineAt,
      );

      const allBannerAssets = [...existing, ...generated];
      await markStepComplete(supabase, store.id, "creative_banners");

      console.log(`[creative_banners] store=${store.id} completed in ${Date.now() - startedAt}ms`);
      return apiSuccess({ bannerAssets: allBannerAssets });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }

      const isTimeout = err instanceof CreativeBannersTimeoutError;
      const message = err instanceof Error ? err.message : "Ad banner generation failed";
      console.error(
        `[creative_banners] store=${store.id} failed after ${Date.now() - startedAt}ms:`,
        message,
      );
      await markJobFailed(supabase, store.id, message);

      if (isTimeout) {
        return apiError(
          "AI_GENERATION_TIMEOUT",
          "Ad banner generation is taking longer than the platform allows right now. " +
            "Whichever banners finished are already saved — try again to generate the rest.",
          { status: 504 },
        );
      }
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
