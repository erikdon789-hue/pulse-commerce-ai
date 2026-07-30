import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Store } from "@/types";

type Guard =
  | { error: NextResponse }
  | { error?: never; supabase: Awaited<ReturnType<typeof createClient>>; store: Store };

// Every pipeline route needs the same check: caller is authenticated and
// owns the store referenced in the URL. RLS would reject a mismatched
// owner_id anyway, but failing fast here gives a clean 401/404 instead of
// an empty result from a silently-filtered query.
export async function requireStoreOwner(storeId: string): Promise<Guard> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: store, error } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .eq("owner_id", user.id)
    .single();

  if (error || !store) {
    return { error: NextResponse.json({ error: "Store not found" }, { status: 404 }) };
  }

  return { supabase, store };
}
