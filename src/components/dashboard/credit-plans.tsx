"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api/fetch-json";

const PLANS = [
  { id: "starter", name: "Starter", price: "$19/mo", credits: 5 },
  { id: "growth", name: "Growth", price: "$49/mo", credits: 20 },
  { id: "scale", name: "Scale", price: "$149/mo", credits: 75 },
] as const;

export function CreditPlans() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubscribe(planId: string) {
    setLoadingPlan(planId);
    setError(null);
    try {
      const { url } = await fetchJson<{ url: string }>("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setLoadingPlan(null);
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <Card key={plan.id}>
            <h3 className="font-semibold">{plan.name}</h3>
            <p className="mt-2 text-2xl font-semibold">{plan.price}</p>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {plan.credits} store builds / month
            </p>
            <Button
              className="mt-4 w-full"
              variant="secondary"
              disabled={loadingPlan !== null && loadingPlan !== plan.id}
              loading={loadingPlan === plan.id}
              onClick={() => handleSubscribe(plan.id)}
            >
              {loadingPlan === plan.id ? "Redirecting…" : "Subscribe"}
            </Button>
          </Card>
        ))}
      </div>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </div>
  );
}
