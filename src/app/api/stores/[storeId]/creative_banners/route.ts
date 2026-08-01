import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import type { CreativeAsset } from "@/types";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";
import type { createClient } from "@/lib/supabase/server";

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
//
// Uses Promise.allSettled, not Promise.all: verified in production that a
// fast failure on one banner (e.g. a rate limit, which rejects almost
// instantly) otherwise short-circuits Promise.all before slower siblings
// get a chance to finish and self-persist — losing exactly the partial
// progress this design exists to keep. allSettled lets every banner run to
// its own conclusion independently.
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

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function generateAndPersistBanner(
  supabase: SupabaseServerClient,
  storeId: string,
  banner: CreativeBriefs["ad_banners"][number],
): Promise<CreativeAsset> {
  const buffer = await generateImageBuffer(banner.image_prompt).catch((err) => {
    throw new Error(
      `${banner.platform} ad banner image generation failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  });
  const imageUrl = await uploadGeneratedImage(`${storeId}/ad-${banner.platform}-${Date.now()}.png`, buffer);

  const { data: saved, error } = await supabase
    .from("creative_assets")
    .insert({
      store_id: storeId,
      type: "ad_banner",
      platform: banner.platform,
      brief_text: banner.brief,
      image_url: imageUrl,
    })
    .select()
    .single();

  if (error) {
    // A concurrent request already inserted this exact platform first — the
    // creative_assets_unique_banner partial index rejects the second
    // insert. Treat that as success.
    if (error.code === "23505") {
      const { data: raceWinner } = await supabase
        .from("creative_assets")
        .select("*")
        .eq("store_id", storeId)
        .eq("type", "ad_banner")
        .eq("platform", banner.platform)
        .maybeSingle();
      return raceWinner as CreativeAsset;
    }
    throw new Error(`${banner.platform} ad banner failed to save: ${error.message}`);
  }

  return saved as CreativeAsset;
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
      const settled = await withDeadline(
        Promise.allSettled(
          briefsToGenerate.map((banner) => generateAndPersistBanner(supabase, store.id, banner)),
        ),
        deadlineAt,
      );

      const newlyGenerated: CreativeAsset[] = [];
      const failures: string[] = [];
      settled.forEach((result, i) => {
        if (result.status === "fulfilled") {
          newlyGenerated.push(result.value);
          console.log(
            `[creative_banners] store=${store.id} ${briefsToGenerate[i].platform} done in ${Date.now() - startedAt}ms`,
          );
        } else {
          failures.push(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          );
        }
      });

      const allBannerAssets = [...existing, ...newlyGenerated];

      if (failures.length > 0) {
        // Whichever banners succeeded are already persisted (see
        // generateAndPersistBanner) — a retry will skip them via the
        // missingPlatforms check above and only redo what actually failed.
        const message = failures.join("; ");
        console.error(`[creative_banners] store=${store.id} partial failure:`, message);
        await markJobFailed(supabase, store.id, message);
        return apiError("AI_GENERATION_ERROR", message, { status: 500 });
      }

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
