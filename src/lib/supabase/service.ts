import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { wrapWithMockDb } from "@/lib/mock-db/client";

const MOCK_DATA_API = process.env.MOCK_DATA_API === "true";

// Service-role client for trusted server-only contexts (e.g. Stripe webhooks)
// that must bypass Row Level Security. Never import this from client code.
export function createServiceClient() {
  const client = createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  if (MOCK_DATA_API) {
    return wrapWithMockDb(client) as unknown as typeof client;
  }

  return client;
}
