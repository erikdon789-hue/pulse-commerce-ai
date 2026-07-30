import { createClient } from "@/lib/supabase/server";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", user.id)
    .single();

  if (!profile || profile.credits_balance < 1) {
    return apiError(
      "INSUFFICIENT_CREDITS",
      "Not enough credits to start a new store build",
      { status: 402 },
    );
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
  // start unlimited concurrent builds against the same balance.
  await supabase
    .from("profiles")
    .update({ credits_balance: profile.credits_balance - 1 })
    .eq("id", user.id);
  await supabase.from("credit_ledger").insert({
    owner_id: user.id,
    amount: -1,
    reason: "store_build",
  });

  return apiSuccess({ store }, { status: 201 });
});
