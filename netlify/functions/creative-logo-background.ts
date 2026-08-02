import { createServiceClient } from "@/lib/supabase/service";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { generateImageBuffer } from "@/lib/ai/images";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import type { CreativeBriefs } from "@/lib/ai/schemas";
import { AINotConfiguredError } from "@/lib/openai/client";

// Does the actual logo generation for POST /api/stores/[storeId]/creative_logo
// (see that route for why this runs as a Background Function instead of
// inline: the request/response route only starts this job and returns
// immediately; the frontend polls that same route's GET handler for
// completion). No request/cookie context here, so this uses the
// service-role client directly — same trust model as the Stripe webhook
// handler, since the storeId was already authorized by the route that
// triggered this.
export default async (request: Request) => {
  if (request.headers.get("x-internal-trigger-secret") !== process.env.INTERNAL_TRIGGER_SECRET) {
    return new Response("Forbidden", { status: 401 });
  }

  const { storeId } = (await request.json()) as { storeId: string };
  const supabase = createServiceClient();

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
    console.error(`[creative-logo-background] store=${storeId} missing creative_brief`);
    return new Response("Missing creative_brief", { status: 400 });
  }

  if (existingLogo) {
    // Already done — a duplicate trigger (retry racing an in-flight job)
    // has nothing left to do.
    await markStepComplete(supabase, storeId, "creative_logo");
    return new Response("Already done", { status: 200 });
  }

  const briefs = brand.creative_brief as unknown as CreativeBriefs;
  const startedAt = Date.now();

  try {
    const buffer = await generateImageBuffer(briefs.logo_image_prompt);
    const imageUrl = await uploadGeneratedImage(`${storeId}/logo-${Date.now()}.png`, buffer);
    console.log(`[creative-logo-background] store=${storeId} generated in ${Date.now() - startedAt}ms`);

    const { error } = await supabase
      .from("creative_assets")
      .insert({
        store_id: storeId,
        type: "logo",
        platform: null,
        brief_text: briefs.logo_brief,
        image_url: imageUrl,
      })
      .select()
      .single();

    if (error) {
      // A concurrent trigger already inserted the logo first — the
      // creative_assets_unique_logo partial index rejects the second
      // insert. Nothing more to do; the persisted row is already correct.
      if (error.code === "23505") {
        await markStepComplete(supabase, storeId, "creative_logo");
        return new Response("Already done (race)", { status: 200 });
      }
      throw error;
    }

    await supabase.from("brand_identity").update({ logo_url: imageUrl }).eq("store_id", storeId);
    await markStepComplete(supabase, storeId, "creative_logo");

    console.log(`[creative-logo-background] store=${storeId} completed in ${Date.now() - startedAt}ms`);
    return new Response("OK", { status: 200 });
  } catch (err) {
    const message =
      err instanceof AINotConfiguredError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Logo generation failed";
    console.error(
      `[creative-logo-background] store=${storeId} failed after ${Date.now() - startedAt}ms:`,
      message,
    );
    await markJobFailed(supabase, storeId, message);
    return new Response(message, { status: 500 });
  }
};
