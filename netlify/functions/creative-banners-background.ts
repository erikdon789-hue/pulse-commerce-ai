import { createServiceClient } from "@/lib/supabase/service";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import type { CreativeAsset } from "@/types";
import { AINotConfiguredError } from "@/lib/openai/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

async function generateAndPersistBanner(
  supabase: SupabaseClient<Database>,
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

// Does the actual banner generation for POST
// /api/stores/[storeId]/creative_banners — see creative-logo-background.ts
// for why this is a Background Function, and that route's git history for
// the full incident. Uses Promise.allSettled (not Promise.all), same as
// the route it replaces: a fast-failing banner must not stop slower
// siblings from finishing and persisting independently.
export default async (request: Request) => {
  if (request.headers.get("x-internal-trigger-secret") !== process.env.INTERNAL_TRIGGER_SECRET) {
    return new Response("Forbidden", { status: 401 });
  }

  const { storeId } = (await request.json()) as { storeId: string };
  const supabase = createServiceClient();

  const [{ data: brand }, { data: existingBanners }] = await Promise.all([
    supabase.from("brand_identity").select("*").eq("store_id", storeId).maybeSingle(),
    supabase.from("creative_assets").select("*").eq("store_id", storeId).eq("type", "ad_banner"),
  ]);

  if (!brand || !brand.creative_brief) {
    console.error(`[creative-banners-background] store=${storeId} missing creative_brief`);
    return new Response("Missing creative_brief", { status: 400 });
  }

  const existing = (existingBanners ?? []) as CreativeAsset[];
  const missingPlatforms = PLATFORMS.filter(
    (platform) => !existing.some((asset) => asset.platform === platform),
  );

  if (missingPlatforms.length === 0) {
    await markStepComplete(supabase, storeId, "creative_banners");
    return new Response("Already done", { status: 200 });
  }

  const briefs = brand.creative_brief as unknown as CreativeBriefs;
  const briefsToGenerate = briefs.ad_banners.filter((b) => missingPlatforms.includes(b.platform));
  const startedAt = Date.now();

  try {
    const settled = await Promise.allSettled(
      briefsToGenerate.map((banner) => generateAndPersistBanner(supabase, storeId, banner)),
    );

    const failures: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(
          `[creative-banners-background] store=${storeId} ${briefsToGenerate[i].platform} done in ${Date.now() - startedAt}ms`,
        );
      } else {
        failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    });

    if (failures.length > 0) {
      const message = failures.join("; ");
      console.error(`[creative-banners-background] store=${storeId} partial failure:`, message);
      await markJobFailed(supabase, storeId, message);
      return new Response(message, { status: 500 });
    }

    await markStepComplete(supabase, storeId, "creative_banners");
    console.log(`[creative-banners-background] store=${storeId} completed in ${Date.now() - startedAt}ms`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    const message =
      err instanceof AINotConfiguredError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Ad banner generation failed";
    console.error(
      `[creative-banners-background] store=${storeId} failed after ${Date.now() - startedAt}ms:`,
      message,
    );
    await markJobFailed(supabase, storeId, message);
    return new Response(message, { status: 500 });
  }
};
