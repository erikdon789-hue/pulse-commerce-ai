import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";

// Must match the free-credit grant in supabase/migrations/0003_auth_trigger.sql.
const STARTER_CREDITS = 3;

export const GET = withRoute(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return apiError("UNAUTHENTICATED", "Not authenticated", { status: 401 });
  }

  const { data: stores, error } = await supabase
    .from("stores")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return apiError("DATABASE_ERROR", error.message, { status: 500 });
  }

  return apiSuccess({ stores });
});

export const POST = withRoute(async (request: Request) => {
  const { name, source_type, source_input } = await request.json();

  if (!name || !source_type || !source_input) {
    return apiError(
      "VALIDATION_ERROR",
      "name, source_type, and source_input are required",
      { status: 400 },
    );
  }

  if (source_type !== "idea" && source_type !== "link") {
    return apiError("VALIDATION_ERROR", "source_type must be 'idea' or 'link'", {
      status: 400,
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return apiError("UNAUTHENTICATED", "Not authenticated", { status: 401 });
  }

  // Dev-only escape hatch, same shape as MOCK_DATA_API in .env.local.example.
  // Double-gated so it can never activate against a real deployment: Netlify/
  // Vercel/`next build` all set NODE_ENV=production regardless of what env
  // vars happen to be set, so this stays off even if ALLOW_DEV_CREDIT_BYPASS
  // is left on in a misconfigured environment.
  const devCreditBypass =
    process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_CREDIT_BYPASS === "true";

  let creditsBalance: number | null = null;

  if (!devCreditBypass) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .maybeSingle();

    // A real query failure (e.g. the Data API rejecting the request) must
    // surface as an error, not get silently treated as "no credits" — that
    // previously made unrelated infra failures look identical to a billing
    // block. Only an actually-missing row falls through to provisioning.
    if (profileError) {
      return apiError("DATABASE_ERROR", profileError.message, { status: 500 });
    }

    if (profile) {
      creditsBalance = profile.credits_balance;
    } else {
      // No profiles row for this user yet. 0003_auth_trigger.sql normally
      // creates one with starter credits on signup; this covers accounts
      // that predate the trigger or where it didn't fire. profiles has no
      // client-side INSERT policy by design, so this needs the service-role
      // client. Plain insert (not upsert) so a race with the trigger, or a
      // retry, can never overwrite an existing balance back to the starter
      // amount — a duplicate-key error just means it already exists.
      const service = createServiceClient();
      const { error: insertError } = await service.from("profiles").insert({
        id: user.id,
        email: user.email ?? "",
        credits_balance: STARTER_CREDITS,
      });

      if (insertError && insertError.code !== "23505") {
        return apiError("DATABASE_ERROR", insertError.message, { status: 500 });
      }

      const { data: provisioned, error: refetchError } = await service
        .from("profiles")
        .select("credits_balance")
        .eq("id", user.id)
        .single();

      if (refetchError) {
        return apiError("DATABASE_ERROR", refetchError.message, { status: 500 });
      }

      creditsBalance = provisioned.credits_balance;
    }

    if (creditsBalance === null || creditsBalance < 1) {
      return apiError(
        "INSUFFICIENT_CREDITS",
        "Not enough credits to start a new store build",
        { status: 402 },
      );
    }
  }

  const { data: store, error } = await supabase
    .from("stores")
    .insert({ owner_id: user.id, name, source_type, source_input, status: "draft" })
    .select()
    .single();

  if (error) {
    return apiError("DATABASE_ERROR", error.message, { status: 500 });
  }

  // Reserve the credit up front rather than at completion, so a user can't
  // start unlimited concurrent builds against the same balance. Skipped
  // entirely in the dev bypass — no ledger entry, no balance mutation.
  if (!devCreditBypass && creditsBalance !== null) {
    await supabase
      .from("profiles")
      .update({ credits_balance: creditsBalance - 1 })
      .eq("id", user.id);
    await supabase.from("credit_ledger").insert({
      owner_id: user.id,
      amount: -1,
      reason: "store_build",
    });
  }

  return apiSuccess({ store }, { status: 201 });
});
