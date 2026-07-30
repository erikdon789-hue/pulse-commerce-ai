import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Store } from "@/types";

async function getStores(): Promise<{ stores: Store[]; error: "not-configured" | null }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { stores: [], error: null };

    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { stores: data ?? [], error: null };
  } catch {
    return { stores: [], error: "not-configured" };
  }
}

const STATUS_LABEL: Record<Store["status"], string> = {
  draft: "Draft",
  building: "Building…",
  ready: "Ready",
  connected: "Connected to Shopify",
  launched: "Launched",
  failed: "Failed",
};

export default async function DashboardStoresPage() {
  const { stores, error } = await getStores();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Stores</h1>
        <Link href="/dashboard/new">
          <Button size="sm">New store</Button>
        </Link>
      </div>

      {error && (
        <Card className="mt-6 border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Supabase isn&apos;t configured yet. Add real values to{" "}
          <code>.env.local</code> and run the migrations in{" "}
          <code>supabase/migrations/</code> to start building stores.
        </Card>
      )}

      {!error && stores.length === 0 && (
        <Card className="mt-6 text-sm text-neutral-600 dark:text-neutral-300">
          No stores yet.{" "}
          <Link href="/dashboard/new" className="text-violet-600 hover:underline">
            Start your first one
          </Link>{" "}
          with a product idea or an Alibaba/AliExpress link.
        </Card>
      )}

      {stores.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((store) => (
            <Link key={store.id} href={`/dashboard/${store.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <h3 className="font-semibold">{store.name}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {store.source_input}
                </p>
                <span className="mt-4 inline-block rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {STATUS_LABEL[store.status]}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
