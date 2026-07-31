import { describe, it, expect, vi } from "vitest";

// Simulates the real unique index from 0004_credit_ledger_idempotency.sql —
// a second insert with a stripe_event_id already present fails with
// Postgres's unique-violation code, exactly like the real database would.
function fakeSupabaseWithLedgerConstraint() {
  const profiles = new Map<string, { id: string; credits_balance: number }>([
    ["user-1", { id: "user-1", credits_balance: 5 }],
  ]);
  const seenEventIds = new Set<string>();
  const ledgerRows: unknown[] = [];

  function makeChain(table: string) {
    let filters: Record<string, unknown> = {};
    let pendingUpdate: Record<string, unknown> | null = null;
    let pendingInsert: Record<string, unknown> | null = null;

    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters = { ...filters, [col]: val };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        pendingUpdate = payload;
        return chain;
      },
      insert: (payload: Record<string, unknown>) => {
        pendingInsert = payload;
        return chain;
      },
      single: async () => {
        if (table === "profiles") {
          const profile = profiles.get(filters.id as string);
          return { data: profile ?? null, error: profile ? null : { message: "not found" } };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        if (table === "profiles" && pendingUpdate) {
          const profile = profiles.get(filters.id as string);
          if (profile) Object.assign(profile, pendingUpdate);
          resolve({ data: null, error: null });
          return;
        }
        if (table === "credit_ledger" && pendingInsert) {
          const eventId = pendingInsert.stripe_event_id as string | undefined;
          if (eventId && seenEventIds.has(eventId)) {
            resolve({ data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } });
            return;
          }
          if (eventId) seenEventIds.add(eventId);
          ledgerRows.push(pendingInsert);
          resolve({ data: pendingInsert, error: null });
          return;
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }

  return { from: (table: string) => makeChain(table), profiles, ledgerRows };
}

const CHECKOUT_EVENT = {
  id: "evt_test_1",
  type: "checkout.session.completed",
  data: {
    object: {
      client_reference_id: "user-1",
      metadata: { planId: "starter" },
      customer: null,
    },
  },
};

async function loadRouteWithMocks(supabase: ReturnType<typeof fakeSupabaseWithLedgerConstraint>) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/service", () => ({ createServiceClient: () => supabase }));
  vi.doMock("@/lib/stripe/client", () => ({
    stripe: { webhooks: { constructEvent: () => CHECKOUT_EVENT } },
  }));
  vi.doMock("@/lib/stripe/plans", () => ({
    PLANS: { starter: { credits: 10, priceId: "price_1" } },
    planIdForPriceId: () => null,
  }));
  const { POST } = await import("./route");
  return POST;
}

describe("POST /api/webhooks/stripe — credit-grant idempotency", () => {
  it("grants credits once for a checkout.session.completed event", async () => {
    const supabase = fakeSupabaseWithLedgerConstraint();
    const POST = await loadRouteWithMocks(supabase);

    const res = await POST(
      new Request("http://test", {
        method: "POST",
        headers: { "stripe-signature": "sig" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(200);
    expect(supabase.profiles.get("user-1")?.credits_balance).toBe(15);
    expect(supabase.ledgerRows).toHaveLength(1);
  });

  it("does not double-grant credits when Stripe redelivers the same event", async () => {
    const supabase = fakeSupabaseWithLedgerConstraint();
    const POST = await loadRouteWithMocks(supabase);

    await POST(
      new Request("http://test", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" }),
    );
    // Stripe retries — same event, delivered again.
    const secondRes = await POST(
      new Request("http://test", { method: "POST", headers: { "stripe-signature": "sig" }, body: "{}" }),
    );

    expect(secondRes.status).toBe(200); // still acknowledged, not an error
    expect(supabase.profiles.get("user-1")?.credits_balance).toBe(15); // not 25
    expect(supabase.ledgerRows).toHaveLength(1); // not 2
  });
});
