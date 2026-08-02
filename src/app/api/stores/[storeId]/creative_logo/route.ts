import { requireStoreOwner } from "@/lib/pipeline/guard";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { triggerBackgroundFunction } from "@/lib/pipeline/trigger-background";

// This route only starts and checks on logo generation — the actual OpenAI
// call runs in netlify/functions/creative-logo-background.ts as a Netlify
// Background Function (up to 15 min), not inline here. That split exists
// because this app's synchronous routes are capped by the Netlify plan's
// function timeout, which is shorter than a single image generation call
// reliably takes — confirmed by direct production reproduction: the client
// got a raw ECONNRESET ~16-17s into the request while the (then-inline)
// route was still running past 24s internally, meaning the connection was
// being cut by the platform itself, independent of and before this code's
// own completion. A response-streaming keep-alive was also tried earlier
// in this pipeline's history and reproducibly failed on this Netlify/
// Next.js adapter (background work doesn't survive past the handler
// returning a Response). Background Functions are the mechanism Netlify
// actually supports for work like this.
//
// POST starts the job (idempotent — returns immediately if already done).
// GET reports current status; the frontend polls it after a POST returns
// {status:"started"} (see src/components/dashboard/store-builder.tsx).
export const POST = withRoute(
  async (request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const [{ data: brand }, { data: existingLogo }] = await Promise.all([
      supabase.from("brand_identity").select("creative_brief").eq("store_id", storeId).maybeSingle(),
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

    // Idempotent: already done (previous run succeeded, or this is a
    // retry/double-click) — nothing to start.
    if (existingLogo) {
      return apiSuccess({ status: "done", logoAsset: existingLogo });
    }

    try {
      await triggerBackgroundFunction(request, "creative-logo-background", {
        storeId: store.id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start logo generation";
      console.error(`[creative_logo] store=${store.id} failed to trigger background job:`, message);
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

    const [{ data: existingLogo }, { data: job }] = await Promise.all([
      supabase
        .from("creative_assets")
        .select("*")
        .eq("store_id", storeId)
        .eq("type", "logo")
        .maybeSingle(),
      supabase
        .from("build_jobs")
        .select("*")
        .eq("store_id", storeId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (existingLogo) {
      return apiSuccess({ status: "done", logoAsset: existingLogo });
    }

    if (job?.status === "failed") {
      return apiSuccess({ status: "failed", error: job.error });
    }

    return apiSuccess({ status: "pending" });
  },
);
