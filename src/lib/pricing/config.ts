// Pricing policy lives here, not in the calculator — changing a multiplier
// or adding a region means editing this file, never touching calculate.ts.

export interface PricingTier {
  // Upper bound of this tier's cost range, inclusive, in cents.
  // null marks the top-open tier (no upper bound).
  maxCostCents: number | null;
  multiplier: number;
}

export interface PricingProfile {
  // Sorted ascending by maxCostCents; must end with one null entry.
  tiers: PricingTier[];
  // Price never goes below cost * this multiplier (e.g. 1.2 = cost + 20%
  // minimum profit), regardless of what the tier multiplier produces.
  minimumProfitMultiplier: number;
}

// Keyed by profile id so country/region-specific pricing (different
// multipliers, different minimum margins, eventually different currencies)
// is additive later: add a "us" / "eu" / etc. entry, no calculator changes.
// Only "default" exists today.
export const PRICING_PROFILES: Record<string, PricingProfile> = {
  default: {
    tiers: [
      { maxCostCents: 1_000, multiplier: 3.5 }, // $0–10
      { maxCostCents: 2_500, multiplier: 3 }, // $10.01–25
      { maxCostCents: 5_000, multiplier: 2.5 }, // $25.01–50
      { maxCostCents: 10_000, multiplier: 2.2 }, // $50.01–100
      { maxCostCents: null, multiplier: 2 }, // $100+
    ],
    minimumProfitMultiplier: 1.2,
  },
};

export const DEFAULT_PRICING_PROFILE = "default";
