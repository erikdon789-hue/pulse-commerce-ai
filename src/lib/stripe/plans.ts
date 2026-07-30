// Credit/subscription plans for the store builder itself. Price IDs come
// from Stripe Dashboard -> Product catalog (create one recurring Price per
// plan) and must be set in .env.local.
export const PLANS = {
  starter: {
    name: "Starter",
    priceId: process.env.STRIPE_PRICE_STARTER ?? "",
    credits: 5,
  },
  growth: {
    name: "Growth",
    priceId: process.env.STRIPE_PRICE_GROWTH ?? "",
    credits: 20,
  },
  scale: {
    name: "Scale",
    priceId: process.env.STRIPE_PRICE_SCALE ?? "",
    credits: 75,
  },
} as const;

export type PlanId = keyof typeof PLANS;

export function planIdForPriceId(priceId: string): PlanId | null {
  const entry = (Object.entries(PLANS) as [PlanId, (typeof PLANS)[PlanId]][]).find(
    ([, plan]) => plan.priceId === priceId,
  );
  return entry ? entry[0] : null;
}
