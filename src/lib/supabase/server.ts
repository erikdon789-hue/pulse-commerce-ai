import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database.types";
import { wrapWithMockDb } from "@/lib/mock-db/client";

const MOCK_DATA_API = process.env.MOCK_DATA_API === "true";

export async function createClient() {
  const cookieStore = await cookies();

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component with no request context to write to.
            // Safe to ignore because the proxy (src/proxy.ts) refreshes the session cookie.
          }
        },
      },
    },
  );

  if (MOCK_DATA_API) {
    return wrapWithMockDb(client) as unknown as typeof client;
  }

  return client;
}
