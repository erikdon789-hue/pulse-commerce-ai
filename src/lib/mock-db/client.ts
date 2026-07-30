import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { MockQueryBuilder } from "@/lib/mock-db/query-builder";

// Wraps a real Supabase client so `.auth` and `.storage` keep hitting the
// real services (both work fine — only the Data API/PostgREST is down),
// while `.from()` is redirected to the in-memory mock. Cast at the call
// site so the rest of the app keeps using the normal SupabaseClient<Database>
// type; this file is the one place that knows it's actually a shim.
export function wrapWithMockDb(realClient: SupabaseClient<Database>) {
  return {
    auth: realClient.auth,
    storage: realClient.storage,
    from: (table: string) => new MockQueryBuilder(table),
  };
}
