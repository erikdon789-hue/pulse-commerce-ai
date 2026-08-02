"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { ViabilityScore } from "@/components/dashboard/viability-score";
import { cn } from "@/lib/utils";
import { fetchJson, ApiClientError } from "@/lib/api/fetch-json";
import type { StoreDetail } from "@/lib/pipeline/get-store-detail";
import type { PipelineStep } from "@/types";

const GENERATION_STEPS: { step: PipelineStep; label: string }[] = [
  { step: "analyze", label: "Analyze viability & audience" },
  { step: "brand", label: "Generate brand identity" },
  { step: "creative_brief", label: "Write creative brief" },
  { step: "creative_logo", label: "Generate logo" },
  { step: "creative_banners", label: "Generate ad banners" },
  { step: "content", label: "Write product content" },
  { step: "seo", label: "Write SEO content" },
  { step: "marketing", label: "Write ad scripts" },
];

type TabKey = "analysis" | "brand" | "content" | "seo" | "marketing";

// creative_logo and creative_banners run as Netlify Background Functions
// (see their routes for why) — the POST only starts the job, so these two
// need polling for completion instead of a single await.
const ASYNC_STEPS = new Set<PipelineStep>(["creative_logo", "creative_banners"]);
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(storeId: string, step: PipelineStep): Promise<Record<string, unknown>> {
  const data = await fetchJson<Record<string, unknown>>(`/api/stores/${storeId}/${step}`, {
    method: "POST",
  });

  if (!ASYNC_STEPS.has(step) || data.status === "done") {
    return data;
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const statusData = await fetchJson<Record<string, unknown>>(
      `/api/stores/${storeId}/${step}`,
      { method: "GET" },
    );
    if (statusData.status === "done") return statusData;
    if (statusData.status === "failed") {
      throw new Error(typeof statusData.error === "string" ? statusData.error : `${step} failed`);
    }
  }

  throw new Error(`${step} is taking longer than expected — please try again`);
}

export function StoreBuilder({ initial }: { initial: StoreDetail }) {
  const [detail, setDetail] = useState(initial);
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("analysis");

  const isDone: Record<PipelineStep, boolean> = {
    ingest: Boolean(detail.product),
    analyze: Boolean(detail.analysis),
    brand: Boolean(detail.brand),
    creative_brief: Boolean(detail.brand?.creative_brief),
    creative_logo: detail.creativeAssets.some((a) => a.type === "logo"),
    // All 3 platforms (tiktok, instagram, facebook) must be persisted —
    // matches the per-platform idempotency check in
    // src/app/api/stores/[storeId]/creative_banners/route.ts.
    creative_banners: detail.creativeAssets.filter((a) => a.type === "ad_banner").length >= 3,
    content: Boolean(detail.content),
    seo: Boolean(detail.seo),
    marketing: detail.marketingContent.length > 0,
    shopify_connect: false,
    shopify_push: false,
  };

  const allDone = GENERATION_STEPS.every(({ step }) => isDone[step]);

  async function runPipeline() {
    setRunning(true);
    setError(null);

    try {
      for (const { step, label } of GENERATION_STEPS) {
        if (isDone[step]) continue;
        setCurrentStep(label);

        const data = await runStep(detail.store.id, step);

        setDetail((prev) => mergeStepResult(prev, step, data));
      }
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Pipeline run failed",
      );
    } finally {
      setRunning(false);
      setCurrentStep(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{detail.store.name}</h1>
            <StatusBadge status={detail.store.status} />
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {detail.store.source_input}
          </p>
        </div>
        {allDone && (
          <Link href={`/dashboard/${detail.store.id}/shopify`}>
            <Button size="sm">Connect Shopify</Button>
          </Link>
        )}
      </div>

      <Card className="mt-6">
        <h2 className="font-semibold">Build progress</h2>
        <ul className="mt-4 space-y-2">
          {GENERATION_STEPS.map(({ step, label }) => {
            const isRunning = currentStep === label;
            return (
              <li key={step} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    isDone[step]
                      ? "bg-violet-600 text-white"
                      : "border border-neutral-300 text-neutral-400 dark:border-neutral-700",
                  )}
                >
                  {isDone[step] ? (
                    <Check className="size-3" />
                  ) : isRunning ? (
                    <Loader2 className="size-3 animate-spin text-violet-600" />
                  ) : null}
                </span>
                <span className={isDone[step] ? "" : "text-neutral-500"}>{label}</span>
                {isRunning && <span className="text-xs text-violet-600">running…</span>}
              </li>
            );
          })}
        </ul>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {!allDone && (
          <Button className="mt-4" onClick={runPipeline} loading={running}>
            {running ? "Building…" : "Run pipeline"}
          </Button>
        )}
      </Card>

      {(detail.analysis || detail.brand || detail.content || detail.seo) && (
        <div className="mt-6">
          <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
            {(
              [
                ["analysis", "Analysis"],
                ["brand", "Brand"],
                ["content", "Content"],
                ["seo", "SEO"],
                ["marketing", "Marketing"],
              ] as [TabKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
                  activeTab === key
                    ? "border-violet-600 text-violet-600"
                    : "border-transparent text-neutral-500",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <Card className="mt-4">
            {activeTab === "analysis" && <AnalysisPanel detail={detail} />}
            {activeTab === "brand" && <BrandPanel detail={detail} />}
            {activeTab === "content" && <ContentPanel detail={detail} />}
            {activeTab === "seo" && <SeoPanel detail={detail} />}
            {activeTab === "marketing" && <MarketingPanel detail={detail} />}
          </Card>
        </div>
      )}
    </div>
  );
}

function mergeStepResult(
  prev: StoreDetail,
  step: PipelineStep,
  json: Record<string, unknown>,
): StoreDetail {
  switch (step) {
    case "analyze":
      return { ...prev, analysis: json.analysis as StoreDetail["analysis"] };
    case "brand":
      return { ...prev, brand: json.brand as StoreDetail["brand"] };
    case "creative_brief":
      return {
        ...prev,
        brand: prev.brand
          ? ({ ...prev.brand, creative_brief: json.brief } as StoreDetail["brand"])
          : prev.brand,
      };
    case "creative_logo": {
      const logoAsset = json.logoAsset as StoreDetail["creativeAssets"][number];
      return {
        ...prev,
        creativeAssets: [
          ...prev.creativeAssets.filter((a) => a.type !== "logo"),
          logoAsset,
        ],
        brand: prev.brand ? { ...prev.brand, logo_url: logoAsset.image_url } : prev.brand,
      };
    }
    case "creative_banners":
      return {
        ...prev,
        creativeAssets: [
          ...prev.creativeAssets.filter((a) => a.type !== "ad_banner"),
          ...(json.bannerAssets as StoreDetail["creativeAssets"]),
        ],
      };
    case "content":
      return { ...prev, content: json.content as StoreDetail["content"] };
    case "seo":
      return { ...prev, seo: json.seo as StoreDetail["seo"] };
    case "marketing":
      return {
        ...prev,
        marketingContent: json.marketingContent as StoreDetail["marketingContent"],
      };
    default:
      return prev;
  }
}

function AnalysisPanel({ detail }: { detail: StoreDetail }) {
  const a = detail.analysis;
  if (!a) return <EmptyState label="analysis" />;
  const audience = a.target_audience as {
    demographics?: string;
    psychographics?: string;
    pain_points?: string[];
  };
  const competitors = (a.competitors as { name: string; differentiator: string }[]) ?? [];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <ViabilityScore score={a.viability_score} />
        <p className="mt-2 text-neutral-600 dark:text-neutral-300">{a.viability_reasoning}</p>
      </div>
      <div>
        <span className="font-semibold">Positioning:</span>
        <p className="mt-1 text-neutral-600 dark:text-neutral-300">{a.positioning}</p>
      </div>
      <div>
        <span className="font-semibold">Target audience:</span>
        <p className="mt-1 text-neutral-600 dark:text-neutral-300">{audience.demographics}</p>
        <p className="text-neutral-600 dark:text-neutral-300">{audience.psychographics}</p>
      </div>
      <div>
        <span className="font-semibold">Competitors:</span>
        <ul className="mt-1 list-disc pl-5 text-neutral-600 dark:text-neutral-300">
          {competitors.map((c) => (
            <li key={c.name}>
              {c.name} — {c.differentiator}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <span className="font-semibold">Marketing angles:</span>
        <ul className="mt-1 list-disc pl-5 text-neutral-600 dark:text-neutral-300">
          {(a.marketing_angles as string[]).map((angle) => (
            <li key={angle}>{angle}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BrandPanel({ detail }: { detail: StoreDetail }) {
  const b = detail.brand;
  if (!b) return <EmptyState label="brand" />;
  const colors = b.colors as { primary: string; secondary: string; accent: string };
  const fonts = b.fonts as { heading: string; body: string };
  return (
    <div className="space-y-4 text-sm">
      {b.logo_url && (
        // Generated logo preview.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.logo_url} alt={`${b.brand_name} logo`} className="size-24 rounded-lg" />
      )}
      <div>
        <span className="font-semibold">{b.brand_name}</span>
        <p className="text-neutral-600 dark:text-neutral-300">{b.slogan}</p>
      </div>
      <div className="flex gap-2">
        {Object.entries(colors ?? {}).map(([name, hex]) => (
          <div key={name} className="text-center">
            <div
              className="size-8 rounded-full border border-neutral-200"
              style={{ backgroundColor: hex }}
            />
            <span className="text-xs text-neutral-500">{name}</span>
          </div>
        ))}
      </div>
      <p className="text-neutral-600 dark:text-neutral-300">
        Fonts: {fonts?.heading} / {fonts?.body}
      </p>
      <p className="text-neutral-600 dark:text-neutral-300">Tone: {b.tone_of_voice}</p>
      {detail.creativeAssets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {detail.creativeAssets
            .filter((asset) => asset.type === "ad_banner" && asset.image_url)
            .map((asset) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={asset.id}
                src={asset.image_url!}
                alt={asset.brief_text}
                className="rounded-lg"
              />
            ))}
        </div>
      )}
    </div>
  );
}

function ContentPanel({ detail }: { detail: StoreDetail }) {
  const c = detail.content;
  if (!c) return <EmptyState label="content" />;
  const pricing = c.pricing_strategy as {
    suggested_price_cents: number;
    compare_at_price_cents: number | null;
    reasoning: string;
  };
  const faqs = c.faqs as { question: string; answer: string }[];
  const upsells = c.upsells as { name: string; pitch: string }[];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <span className="font-semibold">{c.title}</span>
        <p className="mt-1 text-neutral-600 dark:text-neutral-300">{c.description}</p>
      </div>
      <div>
        <span className="font-semibold">Benefits:</span>
        <ul className="mt-1 list-disc pl-5 text-neutral-600 dark:text-neutral-300">
          {(c.benefits as string[]).map((benefit) => (
            <li key={benefit}>{benefit}</li>
          ))}
        </ul>
      </div>
      <div>
        <span className="font-semibold">Pricing:</span>{" "}
        {(pricing.suggested_price_cents / 100).toFixed(2)}
        {pricing.compare_at_price_cents
          ? ` (compare at ${(pricing.compare_at_price_cents / 100).toFixed(2)})`
          : ""}
        <p className="text-neutral-600 dark:text-neutral-300">{pricing.reasoning}</p>
      </div>
      <div>
        <span className="font-semibold">FAQs:</span>
        <div className="mt-1 space-y-2">
          {faqs.map((faq) => (
            <div key={faq.question}>
              <p className="font-medium">{faq.question}</p>
              <p className="text-neutral-600 dark:text-neutral-300">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <span className="font-semibold">Upsells:</span>
        <ul className="mt-1 list-disc pl-5 text-neutral-600 dark:text-neutral-300">
          {upsells.map((u) => (
            <li key={u.name}>
              {u.name} — {u.pitch}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SeoPanel({ detail }: { detail: StoreDetail }) {
  const s = detail.seo;
  if (!s) return <EmptyState label="SEO content" />;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <span className="font-semibold">SEO title:</span> {s.seo_title}
      </div>
      <div>
        <span className="font-semibold">Meta description:</span> {s.meta_description}
      </div>
      <div>
        <span className="font-semibold">Keywords:</span>{" "}
        {(s.keywords as string[]).join(", ")}
      </div>
      <div>
        <span className="font-semibold">Collection:</span> {detail.store.collection_title}
        <p className="text-neutral-600 dark:text-neutral-300">
          {detail.store.collection_description}
        </p>
      </div>
    </div>
  );
}

function MarketingPanel({ detail }: { detail: StoreDetail }) {
  if (detail.marketingContent.length === 0) return <EmptyState label="marketing content" />;
  return (
    <div className="space-y-6 text-sm">
      {detail.marketingContent.map((m) => (
        <div key={m.id}>
          <h3 className="font-semibold capitalize">{m.platform.replace("_", " ")}</h3>
          <p className="mt-1 font-medium">Hooks</p>
          <ul className="list-disc pl-5 text-neutral-600 dark:text-neutral-300">
            {(m.hooks as string[]).map((hook) => (
              <li key={hook}>{hook}</li>
            ))}
          </ul>
          <p className="mt-2 font-medium">Captions</p>
          <ul className="list-disc pl-5 text-neutral-600 dark:text-neutral-300">
            {(m.captions as string[]).map((caption) => (
              <li key={caption}>{caption}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="text-sm text-neutral-500">
      No {label} yet — run the pipeline above.
    </p>
  );
}
