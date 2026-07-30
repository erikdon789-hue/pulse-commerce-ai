import Link from "next/link";
import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Starter",
    price: "$19/mo",
    credits: 5,
    description: "Try the builder with a handful of stores.",
    features: [
      "5 full store builds / month",
      "Viability analysis & brand generation",
      "AI logo & ad creatives",
      "Connect 1 Shopify store",
    ],
  },
  {
    name: "Growth",
    price: "$49/mo",
    credits: 20,
    description: "For sellers testing multiple products at once.",
    features: [
      "20 full store builds / month",
      "Everything in Starter",
      "Priority generation queue",
      "Connect unlimited Shopify stores",
    ],
    highlighted: true,
  },
  {
    name: "Scale",
    price: "$149/mo",
    credits: 75,
    description: "For agencies and high-volume product testers.",
    features: [
      "75 full store builds / month",
      "Everything in Growth",
      "Priority support",
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-24">
          <h1 className="text-center text-4xl font-semibold tracking-tight">
            Simple, credit-based pricing
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-center text-neutral-600 dark:text-neutral-300">
            One credit builds one full store: analysis, brand, creative, copy,
            SEO, and ad scripts. Manage your plan anytime from Billing.
          </p>
          <div className="mt-16 grid gap-6 sm:grid-cols-3">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={
                  plan.highlighted
                    ? "border-violet-600 ring-1 ring-violet-600"
                    : undefined
                }
              >
                <h2 className="font-semibold">{plan.name}</h2>
                <p className="mt-2 text-3xl font-semibold">{plan.price}</p>
                <p className="mt-1 text-sm text-neutral-500">
                  {plan.credits} store builds included
                </p>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {plan.description}
                </p>
                <ul className="mt-6 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {plan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
                <Link href="/dashboard/billing">
                  <Button
                    className="mt-6 w-full"
                    variant={plan.highlighted ? "primary" : "secondary"}
                  >
                    Choose {plan.name}
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
