import type { createClient } from "@/lib/supabase/server";
import type { PipelineStep } from "@/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Finds (or creates) the store's current in-progress build job and appends
// `step` to it. Read-modify-write is fine here: pipeline steps are driven
// sequentially by the client, not run concurrently against the same store.
export async function markStepComplete(
  supabase: SupabaseServerClient,
  storeId: string,
  step: PipelineStep,
) {
  const { data: existing } = await supabase
    .from("build_jobs")
    .select("*")
    .eq("store_id", storeId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stepsCompleted = [
    ...new Set([...(((existing?.steps_completed as string[]) ?? [])), step]),
  ];

  if (existing) {
    await supabase
      .from("build_jobs")
      .update({
        status: "running",
        current_step: step,
        steps_completed: stepsCompleted,
      })
      .eq("id", existing.id);
    return;
  }

  await supabase.from("build_jobs").insert({
    store_id: storeId,
    status: "running",
    current_step: step,
    steps_completed: stepsCompleted,
  });
}

export async function markJobFailed(
  supabase: SupabaseServerClient,
  storeId: string,
  errorMessage: string,
) {
  const { data: existing } = await supabase
    .from("build_jobs")
    .select("*")
    .eq("store_id", storeId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("build_jobs")
      .update({ status: "failed", error: errorMessage })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("build_jobs")
      .insert({ store_id: storeId, status: "failed", error: errorMessage });
  }

  await supabase.from("stores").update({ status: "failed" }).eq("id", storeId);
}
