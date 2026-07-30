"use client";

import { use, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, cardClassName } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ShopifyConnectPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = use(params);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connectedShop, setConnectedShop] = useState<{ name: string } | null>(null);
  const [pushResult, setPushResult] = useState<{
    collection: { handle: string };
    product: { handle: string };
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/shopify/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_domain: shopDomain, access_token: accessToken }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to connect");
      setConnectedShop(json.shop);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setLoading(false);
    }
  }

  async function handlePush() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/shopify/push`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to push to Shopify");
      setPushResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to push to Shopify");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Connect Shopify</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        In your Shopify admin, go to <strong>Settings → Apps → Develop apps</strong>, create a
        Custom App, grant it <code>write_products</code> and <code>write_content</code> scopes,
        install it, and paste the Admin API access token below.
      </p>

      {!connectedShop ? (
        <form onSubmit={handleConnect} className={cn(cardClassName, "mt-6 space-y-4")}>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Shop domain</span>
            <input
              className={inputClass}
              placeholder="your-store.myshopify.com"
              value={shopDomain}
              onChange={(e) => setShopDomain(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Admin API access token</span>
            <input
              type="password"
              className={inputClass}
              placeholder="shpat_..."
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              required
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            {loading ? "Connecting…" : "Connect store"}
          </Button>
        </form>
      ) : (
        <Card className="mt-6">
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Connected to <strong>{connectedShop.name}</strong>.
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
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </Card>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-600 dark:border-neutral-800 dark:bg-neutral-950";
