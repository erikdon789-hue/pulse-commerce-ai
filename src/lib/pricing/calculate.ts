import { DEFAULT_PRICING_PROFILE, PRICING_PROFILES, type PricingProfile } from "./config";

export interface PriceCalculationInput {
  // Supplier product cost, in cents.
  baseCostCents: number;
  // Per-unit shipping cost, in cents. Defaults to 0 — no supplier provider
  // currently returns real freight-calculation data (CJ exposes this via a
  // separate logistics API keyed by destination country/weight, not yet
  // integrated). Pass 0 rather than guessing a shipping cost.
  shippingCostCents?: number;
  // Pricing profile id (see config.ts) or an inline profile object (used by
  // tests to exercise tiers/floors without touching the shared config).
  // Defaults to "default".
  profile?: string | PricingProfile;
}

export interface PriceCalculationResult {
  costCents: number; // baseCostCents + shippingCostCents
  tierMultiplier: number;
  rawPriceCents: number; // cost * multiplier, before psychological rounding
  minimumPriceCents: number; // cost * minimumProfitMultiplier, before rounding
  priceCents: number; // final price: max(rounded raw price, rounded floor)
  profileId: string | null; // null when an inline profile object was used
}

function resolveProfile(profile: string | PricingProfile | undefined): {
  profile: PricingProfile;
  profileId: string | null;
} {
  if (profile && typeof profile === "object") {
    return { profile, profileId: null };
  }
  const id = profile ?? DEFAULT_PRICING_PROFILE;
  return { profile: PRICING_PROFILES[id] ?? PRICING_PROFILES[DEFAULT_PRICING_PROFILE], profileId: id };
}

function selectTier(profile: PricingProfile, costCents: number) {
  for (const tier of profile.tiers) {
    if (tier.maxCostCents === null || costCents <= tier.maxCostCents) {
      return tier;
    }
  }
  // Unreachable as long as the profile's last tier has maxCostCents: null,
  // but fall back to the highest tier instead of throwing on a malformed
  // profile.
  return profile.tiers[profile.tiers.length - 1];
}

// Psychological rounding: floor to the dollar, then always end in .99.
// This is monotonic (never rounds below its input), which is what lets the
// minimum-profit floor below stay a true floor after rounding.
function toPsychologicalPrice(cents: number): number {
  return Math.floor(cents / 100) * 100 + 99;
}

export function calculateSellingPrice(input: PriceCalculationInput): PriceCalculationResult {
  const shippingCostCents = input.shippingCostCents ?? 0;
  const costCents = input.baseCostCents + shippingCostCents;
  const { profile, profileId } = resolveProfile(input.profile);

  const tier = selectTier(profile, costCents);
  const rawPriceCents = Math.round(costCents * tier.multiplier);
  const minimumPriceCents = Math.ceil(costCents * profile.minimumProfitMultiplier);

  const priceCents = Math.max(
    toPsychologicalPrice(rawPriceCents),
    toPsychologicalPrice(minimumPriceCents),
  );

  return {
    costCents,
    tierMultiplier: tier.multiplier,
    rawPriceCents,
    minimumPriceCents,
    priceCents,
    profileId,
  };
}
