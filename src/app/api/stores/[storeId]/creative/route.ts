import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

// Second half of the former single "creative" step (see
// src/app/api/stores/[storeId]/creative_brief/route.ts for the brief half
// and the full incident writeup). Reproduced directly against production:
// the original combined route (brief + 4 image generations + uploads, ~40s
// total) reliably tripped Netlify's ~30-34s proxy inactivity timeout, which
// kills the connection with a raw platform error because zero response
// bytes are sent while the handler awaits OpenAI/Supabase — confirmed via
// function logs showing the Lambda still running well after the client had
// already received the timeout. A response-streaming keep-alive was also
// tried and reproducibly failed (this Netlify/Next.js adapter does not
// keep background work alive after the handler returns a Response, even a
// streamed one). Splitting into two steps, each independently under that
// window, is the fix that's actually been verified to work.
//
// DEADLINE_MS history, all measured directly against production:
//   28s -> real runs took 29.6-31.4s, deadline fired every time (clean JSON,
//         but never actually succeeded in one request).
//   29.5s -> tried raising it to close that gap; instead one run took 33.28s
//            and came back as a raw 502/text-plain platform error — the
//            deadline lost the race against the real proxy cutoff.
// Conclusion: the real 4-concurrent-image OpenAI call has enough production
// variance (observed 24-33s+) that no value between ~26-30s reliably beats
// the platform's own ~30-34s cutoff. Set conservatively low so this route's
// hard requirement — always return valid JSON, never a raw platform crash —
// actually holds, even though that means it will proactively time out
// (clean, retryable 504) on most requests rather than completing in one
// shot. Retrying picks up on OpenAI's inherent latency variance. If
// one-shot success matters more than this margin, the real fix is
// generating fewer images per request (e.g. logo and banners as separate
// steps), not tuning this number further.
const DEADLINE_MS = 22_000;

class CreativeImagesTimeoutError extends Error {}

function withDeadline<T>(promise: Promise<T>, deadlineAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      reject(new CreativeImagesTimeoutError("Image generation did not finish within the time budget"));
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

    const [{ data: brand }, { data: existingAssets }] = await Promise.all([
      supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
      supabase.from("creative_assets").select("*").eq("store_id", storeId),
    ]);

    if (!brand || !brand.creative_brief) {
      return apiError("PIPELINE_STEP_MISSING", "Run the creative brief step first", {
        status: 400,
      });
    }

    // Idempotent: a retry (double-click, network retry, or a request that
    // succeeded server-side but whose response the client missed) after
    // this step already ran returns the persisted assets instead of paying
    // for another 4 OpenAI image generations.
    if (existingAssets && existingAssets.length > 0) {
      await markStepComplete(supabase, store.id, "creative");
      return apiSuccess({ creativeAssets: existingAssets });
    }

    const briefs = brand.creative_brief as unknown as CreativeBriefs;
    const startedAt = Date.now();
    const deadlineAt = startedAt + DEADLINE_MS;

    try {
      // Logo + all ad banners are independent OpenAI image calls — run them
      // concurrently instead of sequentially. Four sequential generations took
      // 2-4 minutes total, long enough to exceed proxy/tunnel timeouts (e.g.
      // free Cloudflare quick tunnels cut connections around ~100s) even
      // though the endpoint itself completed successfully.
      const [logoResult, ...bannerResults] = await withDeadline(
        Promise.all([
          generateImageBuffer(briefs.logo_image_prompt)
            .then(async (buffer) => ({
              imageUrl: await uploadGeneratedImage(`${store.id}/logo-${Date.now()}.png`, buffer),
            }))
            .catch((err) => {
              throw new Error(
                `Logo image generation failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }),
          ...briefs.ad_banners.map((banner) =>
            generateImageBuffer(banner.image_prompt)
              .then(async (buffer) => ({
                platform: banner.platform,
                brief: banner.brief,
                imageUrl: await uploadGeneratedImage(
                  `${store.id}/ad-${banner.platform}-${Date.now()}.png`,
                  buffer,
                ),
              }))
              .catch((err) => {
                throw new Error(
                  `${banner.platform} ad banner image generation failed: ` +
                    `${err instanceof Error ? err.message : String(err)}`,
                );
              }),
          ),
        ]),
        deadlineAt,
      );
      console.log(`[creative] store=${store.id} images done in ${Date.now() - startedAt}ms`);

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

      if (error) {
        // A concurrent request (double-click, retry racing an in-flight
        // request) already inserted these rows first — the partial unique
        // indexes from 0006_creative_brief_split.sql reject the second
        // insert. Treat that as success and return what's actually there.
        if (error.code === "23505") {
          const { data: raceWinnerAssets } = await supabase
            .from("creative_assets")
            .select("*")
            .eq("store_id", store.id);
          await markStepComplete(supabase, store.id, "creative");
          return apiSuccess({ creativeAssets: raceWinnerAssets ?? [] });
        }
        throw error;
      }

      await markStepComplete(supabase, store.id, "creative");

      console.log(`[creative] store=${store.id} completed in ${Date.now() - startedAt}ms`);
      return apiSuccess({ creativeAssets: savedAssets });
    } catch (err) {
      if (err instanceof AINotConfiguredError) {
        return apiError("AI_NOT_CONFIGURED", err.message, { status: 503 });
      }

      const isTimeout = err instanceof CreativeImagesTimeoutError;
      const message = err instanceof Error ? err.message : "Creative image generation failed";
      console.error(
        `[creative] store=${store.id} failed after ${Date.now() - startedAt}ms:`,
        message,
      );
      await markJobFailed(supabase, store.id, message);

      if (isTimeout) {
        return apiError(
          "AI_GENERATION_TIMEOUT",
          "Creative generation is taking longer than the platform allows right now " +
            "(image generation can be slow under load). Please try again.",
          { status: 504 },
        );
      }
      return apiError("AI_GENERATION_ERROR", message, { status: 500 });
    }
  },
);
