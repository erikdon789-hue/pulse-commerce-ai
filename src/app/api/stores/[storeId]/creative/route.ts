import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateStructured } from "@/lib/ai/generate";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import { creativeBriefsSchema } from "@/lib/ai/schemas";
import { apiError, withRoute } from "@/lib/api/response";
import { AINotConfiguredError } from "@/lib/openai/client";

// Confirmed against production (reproduced directly, function logs
// correlated by timestamp): this route was NOT being killed by a function
// duration limit. It was hitting an upstream proxy's INACTIVITY timeout —
// "Inactivity Timeout: too much time has passed without sending any data
// for document" — because this handler sends zero response bytes while it
// awaits OpenAI/Supabase. That proxy cut the connection at ~34s in testing,
// well under this route's real work time (brief ~14-18s + 4 concurrent
// image generations ~24s), while the Lambda itself kept running behind the
// scenes (its logs show it completing well after the client had already
// received the timeout page). A larger in-app deadline can't fix this —
// the client-visible connection dies from silence, not from total duration.
//
// Fix: stream the response and emit a keep-alive byte every few seconds
// while the real work runs, so the proxy always sees recent activity. A
// leading whitespace byte before the final JSON payload is valid per the
// JSON grammar (RFC 8259 permits whitespace around any JSON value) and is
// ignored by JSON.parse/res.json() once the real body follows.
export const maxDuration = 60;

const DEADLINE_MS = 50_000; // ~10s headroom under Netlify's fixed 60s ceiling
const KEEPALIVE_INTERVAL_MS = 5_000; // well under the ~30-34s proxy inactivity cutoff observed

class CreativeTimeoutError extends Error {}

// Races `promise` against the shared per-request deadline instead of a
// fixed per-call timeout, so time already spent (e.g. on brief generation)
// eats into the budget left for the next stage (image generation).
function withDeadline<T>(promise: Promise<T>, deadlineAt: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const ms = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(() => {
      reject(new CreativeTimeoutError(`${label} did not finish within the time budget`));
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

    const startedAt = Date.now();
    const deadlineAt = startedAt + DEADLINE_MS;
    console.log(`[creative] store=${store.id} started`);

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const keepAlive = setInterval(() => {
      streamController.enqueue(encoder.encode(" "));
    }, KEEPALIVE_INTERVAL_MS);

    function finish(body: Record<string, unknown>) {
      clearInterval(keepAlive);
      streamController.enqueue(encoder.encode(JSON.stringify(body)));
      streamController.close();
    }

    (async () => {
      try {
        const briefStart = Date.now();
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
          "Creative brief generation",
        );
        console.log(`[creative] store=${store.id} brief done in ${Date.now() - briefStart}ms`);

        // Logo + all ad banners are independent OpenAI image calls — run them
        // concurrently instead of sequentially. Four sequential generations took
        // 2-4 minutes total, long enough to exceed proxy/tunnel and serverless
        // function timeouts (e.g. free Cloudflare quick tunnels cut connections
        // around ~100s) even though the endpoint itself completed successfully.
        const imagesStart = Date.now();
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
          "Image generation",
        );
        console.log(`[creative] store=${store.id} images done in ${Date.now() - imagesStart}ms`);

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

        console.log(`[creative] store=${store.id} completed in ${Date.now() - startedAt}ms`);
        finish({ ok: true, data: { creativeAssets: savedAssets } });
      } catch (err) {
        if (err instanceof AINotConfiguredError) {
          finish({
            ok: false,
            error: { code: "AI_NOT_CONFIGURED", message: err.message },
          });
          return;
        }

        const isTimeout = err instanceof CreativeTimeoutError;
        const message = err instanceof Error ? err.message : "Creative generation failed";
        console.error(
          `[creative] store=${store.id} failed after ${Date.now() - startedAt}ms:`,
          message,
        );
        await markJobFailed(supabase, store.id, message);

        if (isTimeout) {
          finish({
            ok: false,
            error: {
              code: "AI_GENERATION_TIMEOUT",
              message:
                "Creative generation is taking longer than the platform allows right now " +
                "(image generation can be slow under load). Please try again.",
            },
          });
          return;
        }
        finish({ ok: false, error: { code: "AI_GENERATION_ERROR", message } });
      }
    })();

    // Status is fixed at 200 because it must be committed before the async
    // work above resolves — real success/failure is carried in the JSON body
    // (`{ ok: true/false, ... }`), which is what src/lib/api/fetch-json.ts
    // already branches on rather than the HTTP status.
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
);
