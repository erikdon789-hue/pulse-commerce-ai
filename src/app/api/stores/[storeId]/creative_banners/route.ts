import { requireStoreOwner } from "@/lib/pipeline/guard";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { triggerBackgroundFunction } from "@/lib/pipeline/trigger-background";
import type { CreativeAsset } from "@/types";

const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

// This route only starts and checks on ad banner generation — the actual
// OpenAI calls run in netlify/functions/creative-banners-background.ts as a
// Netlify Background Function (up to 15 min). See
// src/app/api/stores/[storeId]/creative_logo/route.ts for why (this app's
// synchronous routes are capped well below what image generation reliably
// takes, confirmed by direct production reproduction).
//
// POST starts the job (idempotent, per-platform — only triggers generation
// for platforms not already persisted). GET reports current status; the
// frontend polls it after a POST returns {status:"started"}.
export const POST = withRoute(
  async (request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const [{ data: brand }, { data: existingBanners }] = await Promise.all([
      supabase.from("brand_identity").select("creative_brief").eq("store_id", storeId).maybeSingle(),
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
    const allPresent = PLATFORMS.every((platform) => existing.some((a) => a.platform === platform));

    // Idempotent: all 3 already persisted — nothing to start.
    if (allPresent) {
      return apiSuccess({ status: "done", bannerAssets: existing });
    }

    try {
      await triggerBackgroundFunction(request, "creative-banners-background", {
        storeId: store.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start ad banner generation";
      console.error(`[creative_banners] store=${store.id} failed to trigger background job:`, message);
      return apiError("BACKGROUND_TRIGGER_FAILED", message, { status: 500 });
    }

    return apiSuccess({ status: "started" });
  },
);

export const GET = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase } = guard;

    const [{ data: existingBanners }, { data: job }] = await Promise.all([
      supabase
        .from("creative_assets")
        .select("*")
        .eq("store_id", storeId)
        .eq("type", "ad_banner"),
      supabase
        .from("build_jobs")
        .select("*")
        .eq("store_id", storeId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const existing = (existingBanners ?? []) as CreativeAsset[];
    const allPresent = PLATFORMS.every((platform) => existing.some((a) => a.platform === platform));

    if (allPresent) {
      return apiSuccess({ status: "done", bannerAssets: existing });
    }

    if (job?.status === "failed") {
      return apiSuccess({ status: "failed", error: job.error });
    }

    return apiSuccess({ status: "pending" });
  },
);
