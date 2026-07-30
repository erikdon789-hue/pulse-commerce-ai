"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cardClassName } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "idea" | "link";

interface ProductDraft {
  title: string;
  description: string;
  price_cents: number | "";
  currency: string;
  images: string;
}

export default function NewStorePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idea");
  const [sourceInput, setSourceInput] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceInput.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const storeRes = await fetch("/api/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sourceInput.slice(0, 60),
          source_type: mode,
          source_input: sourceInput,
        }),
      });
      const storeJson = await storeRes.json();
      if (!storeRes.ok) throw new Error(storeJson.error ?? "Failed to create store");

      setStoreId(storeJson.store.id);

      if (mode === "link") {
        const previewRes = await fetch(`/api/stores/${storeJson.store.id}/ingest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_url: sourceInput }),
        });
        const previewJson = await previewRes.json();
        const preview = previewJson.preview;
        setDraft({
          title: preview?.title ?? "",
          description: preview?.description ?? "",
          price_cents: "",
          currency: "usd",
          images: (preview?.images ?? []).join("\n"),
        });
      } else {
        setDraft({
          title: sourceInput.slice(0, 80),
          description: sourceInput,
          price_cents: "",
          currency: "usd",
          images: "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!storeId || !draft) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/stores/${storeId}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          description: draft.description,
          price_cents: draft.price_cents === "" ? null : Number(draft.price_cents),
          currency: draft.currency,
          images: draft.images.split("\n").map((s) => s.trim()).filter(Boolean),
          source_url: mode === "link" ? sourceInput : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save product");

      router.push(`/dashboard/${storeId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (draft) {
    return (
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold">Confirm product details</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {mode === "link"
            ? "We tried to pull these details from the link automatically — Alibaba/AliExpress often block that, so double-check everything below."
            : "Fill in the starting details for this product."}
        </p>

        <form onSubmit={handleConfirm} className={cn(cardClassName, "mt-6 space-y-4")}>
          <Field label="Title">
            <input
              className={inputClass}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </Field>
          <Field label="Description">
            <textarea
              className={cn(inputClass, "min-h-24")}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Price (cents)">
              <input
                type="number"
                className={inputClass}
                value={draft.price_cents}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    price_cents: e.target.value === "" ? "" : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="Currency">
              <input
                className={inputClass}
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Image URLs (one per line)">
            <textarea
              className={cn(inputClass, "min-h-20")}
              value={draft.images}
              onChange={(e) => setDraft({ ...draft, images: e.target.value })}
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" loading={loading} className="w-full">
            {loading ? "Saving…" : "Continue"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">New store</h1>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
        Give the AI a product idea, or paste an Alibaba/AliExpress link.
      </p>

      <form onSubmit={handleStart} className={cn(cardClassName, "mt-6 space-y-4")}>
        <div className="flex gap-2">
          {(["idea", "link"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium capitalize",
                mode === m
                  ? "border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950"
                  : "border-neutral-200 text-neutral-600 dark:border-neutral-800",
              )}
            >
              {m === "idea" ? "Product idea" : "Product link"}
            </button>
          ))}
        </div>

        <textarea
          className={cn(inputClass, "min-h-28")}
          placeholder={
            mode === "idea"
              ? "e.g. A portable neck fan for people who commute by bike"
              : "https://www.aliexpress.com/item/..."
          }
          value={sourceInput}
          onChange={(e) => setSourceInput(e.target.value)}
          required
        />

        {error && <p className="text-sm text-red-600">{error}</p>}

        <Button type="submit" loading={loading} className="w-full">
          {loading ? "Working…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-600 dark:border-neutral-800 dark:bg-neutral-950";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
        {label}
      </span>
      {children}
    </label>
  );
}
