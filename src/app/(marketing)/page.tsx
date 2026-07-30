import Link from "next/link";
import { Sparkles, Palette, Megaphone, Store } from "lucide-react";
import { Navbar } from "@/components/marketing/navbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Sparkles,
    title: "Product viability analysis",
    description:
      "Paste a product idea or an Alibaba/AliExpress link. Get a viability score, target audience, competitors, and marketing angles before you commit.",
  },
  {
    icon: Palette,
    title: "Full brand identity",
    description:
      "AI generates a brand name, slogan, color palette, fonts, and an actual generated logo and ad creatives — not just a brief.",
  },
  {
    icon: Megaphone,
    title: "Copy & ads, written for you",
    description:
      "Product titles, descriptions, FAQs, SEO content, and TikTok/Reels/Facebook ad scripts and hooks, generated in your brand's voice.",
  },
  {
    icon: Store,
    title: "Pushed straight to Shopify",
    description:
      "Connect your existing Shopify store and push the collection, product, and content directly via the Admin API. No copy-pasting.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
            Turn a product idea into a live Shopify store
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-600 dark:text-neutral-300">
            Pulse Commerce AI is an AI Shopify store builder. Give it a product
            idea or a supplier link — it analyzes the opportunity, builds your
            brand, writes every piece of copy and ad creative, and pushes it
            straight into your Shopify store.
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link href="/dashboard/new">
              <Button size="lg">Build a store</Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="secondary">
                View pricing
              </Button>
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
