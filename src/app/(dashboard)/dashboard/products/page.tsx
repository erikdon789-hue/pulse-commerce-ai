import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Product } from "@/types";

async function getProducts(): Promise<{
  products: Product[];
  error: "not-configured" | null;
}> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return { products: data ?? [], error: null };
  } catch {
    // Expected until NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
    // point at a real project — see README.md setup steps.
    return { products: [], error: "not-configured" };
  }
}

export default async function ProductsPage() {
  const { products, error } = await getProducts();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Button size="sm">Add product</Button>
      </div>

      {error && (
        <Card className="mt-6 border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Supabase isn&apos;t configured yet. Add real values to{" "}
          <code>.env.local</code> and run the migration in{" "}
          <code>supabase/migrations/0001_init.sql</code> to see live products.
        </Card>
      )}

      {!error && products.length === 0 && (
        <Card className="mt-6 text-sm text-neutral-600 dark:text-neutral-300">
          No products yet. Add your first product to get started.
        </Card>
      )}

      {products.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => (
            <Card key={product.id}>
              <h3 className="font-semibold">{product.name}</h3>
              <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
                {(product.price_cents / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: product.currency,
                })}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
