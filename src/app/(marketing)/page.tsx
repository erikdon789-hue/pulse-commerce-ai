import Link from "next/link";
import { Bot, LineChart, ShieldCheck } from "lucide-react";
import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Bot,
    title: "AI shopping assistant",
    description:
      "An OpenAI-powered chat assistant helps customers find the right product and answers questions in real time.",
  },
  {
    icon: LineChart,
    title: "Smart recommendations",
    description:
      "Product embeddings drive personalized recommendations that boost conversion without manual merchandising.",
  },
  {
    icon: ShieldCheck,
    title: "Stripe-native billing",
    description:
      "Checkout, subscriptions, and webhooks are wired to Stripe from day one, with orders synced to Supabase.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            The AI-powered e-commerce platform for modern storefronts
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
            Pulse Commerce AI combines Supabase, Stripe, and OpenAI so you can
            launch a smart storefront without stitching services together
            yourself.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Button size="lg">Start free trial</Button>
            <Link href="/pricing">
              <Button size="lg" variant="secondary">
                View pricing
              </Button>
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-6 sm:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <Card key={title}>
                <Icon className="size-6 text-violet-600" />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
                  {description}
                </p>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
