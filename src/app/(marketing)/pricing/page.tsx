import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Starter",
    price: "$0",
    description: "Try Pulse Commerce AI with a single storefront.",
    features: ["1 storefront", "Up to 25 products", "Community support"],
  },
  {
    name: "Growth",
    price: "$49",
    description: "For stores ready to scale with AI recommendations.",
    features: [
      "Unlimited storefronts",
      "AI recommendations & chat assistant",
      "Stripe subscriptions",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    description: "Dedicated infrastructure and support for large catalogs.",
    features: ["Custom SLAs", "Dedicated Supabase project", "SSO"],
  },
];

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-24">
          <h1 className="text-center text-4xl font-semibold tracking-tight">
            Simple, usage-based pricing
          </h1>
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
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {plan.description}
                </p>
                <ul className="mt-6 space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {plan.features.map((feature) => (
                    <li key={feature}>• {feature}</li>
                  ))}
                </ul>
                <Button
                  className="mt-6 w-full"
                  variant={plan.highlighted ? "primary" : "secondary"}
                >
                  Choose {plan.name}
                </Button>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
