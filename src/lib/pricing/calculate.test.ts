import { describe, it, expect } from "vitest";
import { calculateSellingPrice } from "./calculate";
import type { PricingProfile } from "./config";

describe("calculateSellingPrice", () => {
  it("matches the confirmed worked example: $18.20 cost -> $54.99 (x3 tier)", () => {
    const result = calculateSellingPrice({ baseCostCents: 1_820 });
    expect(result.tierMultiplier).toBe(3);
    expect(result.priceCents).toBe(5_499);
  });

  it("applies the x2.2 tier correctly for a $50.01-100 cost (the spec's worked example used an approximate x2 here, x2.2 was confirmed as the real rule)", () => {
    const result = calculateSellingPrice({ baseCostCents: 8_140 });
    expect(result.tierMultiplier).toBe(2.2);
    expect(result.rawPriceCents).toBe(17_908);
    expect(result.priceCents).toBe(17_999);
  });

  it.each([
    [1_000, 3.5], // $10.00 exactly -> top of the $0-10 tier
    [1_001, 3], // $10.01 -> first cent of the next tier
    [2_500, 3], // $25.00 exactly -> top of the $10.01-25 tier
    [2_501, 2.5], // $25.01 -> next tier
    [5_000, 2.5],
    [5_001, 2.2],
    [10_000, 2.2],
    [10_001, 2], // $100.01 -> top-open tier
    [50_000, 2],
  ])("selects the correct tier multiplier at boundary cost %i cents", (costCents, expectedMultiplier) => {
    expect(calculateSellingPrice({ baseCostCents: costCents }).tierMultiplier).toBe(expectedMultiplier);
  });

  it("always ends the final price in .99", () => {
    for (const cost of [1, 999, 1_500, 33_333, 250_000]) {
      const { priceCents } = calculateSellingPrice({ baseCostCents: cost });
      expect(priceCents % 100).toBe(99);
    }
  });

  it("adds shipping cost into the base before applying the tier", () => {
    const withoutShipping = calculateSellingPrice({ baseCostCents: 900 });
    const withShipping = calculateSellingPrice({ baseCostCents: 900, shippingCostCents: 200 });
    // 900 alone stays in the x3.5 tier (<=1000); +200 shipping pushes cost
    // to 1100, into the x3 tier.
    expect(withoutShipping.tierMultiplier).toBe(3.5);
    expect(withShipping.costCents).toBe(1_100);
    expect(withShipping.tierMultiplier).toBe(3);
  });

  it("never prices below cost + minimum profit margin, even with a below-floor tier multiplier", () => {
    // Inline profile with a multiplier below the minimum-profit floor —
    // impossible with the real "default" profile (all multipliers are well
    // above 1.2x), but this is exactly what the floor exists to guard
    // against if a future config ever set one too low.
    const thinMarginProfile: PricingProfile = {
      tiers: [{ maxCostCents: null, multiplier: 1.05 }],
      minimumProfitMultiplier: 1.2,
    };

    const result = calculateSellingPrice({ baseCostCents: 10_000, profile: thinMarginProfile });

    expect(result.rawPriceCents).toBe(10_500); // 1.05x, below the floor
    expect(result.minimumPriceCents).toBe(12_000); // 1.2x
    expect(result.priceCents).toBe(12_099); // floor wins, still ends in .99
    expect(result.priceCents).toBeGreaterThanOrEqual(result.minimumPriceCents);
  });

  it("falls back to the default profile for an unknown profile id", () => {
    const result = calculateSellingPrice({ baseCostCents: 1_820, profile: "does-not-exist" });
    expect(result.tierMultiplier).toBe(3);
    expect(result.profileId).toBe("does-not-exist");
  });

  it("reports profileId as null when an inline profile object is used", () => {
    const profile: PricingProfile = {
      tiers: [{ maxCostCents: null, multiplier: 2 }],
      minimumProfitMultiplier: 1.2,
    };
    const result = calculateSellingPrice({ baseCostCents: 1_000, profile });
    expect(result.profileId).toBeNull();
  });
});
