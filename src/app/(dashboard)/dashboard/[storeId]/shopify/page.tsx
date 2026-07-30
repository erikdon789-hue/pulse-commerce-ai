"use client";

import { Suspense, use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Card, cardClassName } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/api/fetch-json";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_shop: "That doesn't look like a valid myshopify.com domain.",
  state_mismatch: "The connection attempt expired or was invalid — please try again.",
  shopify_oauth_expired: "The connection attempt expired — please try again.",
  invalid_callback: "Shopify's response was missing required data — please try again.",
  hmac_invalid: "Couldn't verify Shopify's response — please try again.",
  not_authenticated: "Your session expired — please sign in and try again.",
  store_not_found: "Store not found.",
  connect_failed: "Failed to connect the Shopify store — please try again.",
};

export default function ShopifyConnectPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);
  return (
    <Suspense>
      <ShopifyConnectForm storeId={storeId} />
    </Suspense>
  );
}

function ShopifyConnectForm({ storeId }: { storeId: string }) {
  const searchParams = useSearchParams();
  const connectedShop = searchParams.get("shop");
  const errorCode = searchParams.get("error");

  const [pushResult, setPushResult] = useState<{
    collection: { handle: string };
    product: { handle: string };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  async function handlePush() {
    setLoading(true);
    setPushError(null);
    try {
      const data = await fetchJson<{
        collection: { handle: string };
        product: { handle: string };
      }>(`/api/stores/${storeId}/shopify/push`, { method: "POST" });
      setPushResult(data);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Failed to push to Shopify");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Connect Shopify</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        Click connect and approve access in your Shopify admin.
      </p>

      {!connectedShop ? (
        <form
          method="GET"
          action={`/api/stores/${storeId}/shopify/install`}
          className={cn(cardClassName, "mt-6 space-y-4")}
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Shop domain</span>
            <input
              name="shop"
              className={inputClass}
              placeholder="your-store.myshopify.com"
              required
            />
          </label>
          {errorCode && (
            <p className="text-sm text-red-600">
              {ERROR_MESSAGES[errorCode] ?? "Something went wrong — please try again."}
            </p>
          )}
          <Button type="submit" className="w-full">
            Connect store
          </Button>
        </form>
      ) : (
        <Card className="mt-6">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Connected to <strong>{connectedShop}</strong>.
          </p>

          {!pushResult ? (
            <Button className="mt-4" onClick={handlePush} loading={loading}>
              {loading ? "Pushing…" : "Push to Shopify"}
            </Button>
          ) : (
            <div className="mt-4 text-sm text-neutral-600 dark:text-neutral-300">
              <p className="flex items-center gap-2 font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-4" />
                Collection and product created in your Shopify admin.
              </p>
              <p className="mt-2">Product handle: {pushResult.product.handle}</p>
              <p>Collection handle: {pushResult.collection.handle}</p>
            </div>
          )}
          {pushError && <p className="mt-2 text-sm text-red-600">{pushError}</p>}
        </Card>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-600 dark:border-neutral-800 dark:bg-neutral-950";
