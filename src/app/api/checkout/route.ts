import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";
import { PLANS, type PlanId } from "@/lib/stripe/plans";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";

export const POST = withRoute(async (request: Request) => {
  const { planId } = await request.json();

  if (!planId || !(planId in PLANS)) {
    return apiError("VALIDATION_ERROR", "Invalid planId", { status: 400 });
  }

  const plan = PLANS[planId as PlanId];
  if (!plan.priceId) {
    return apiError(
      "STRIPE_NOT_CONFIGURED",
      `No Stripe price configured for plan "${planId}" — set its env var in .env.local`,
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return apiError("UNAUTHENTICATED", "Not authenticated", { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: user.id,
    customer: profile?.stripe_customer_id ?? undefined,
    customer_email: profile?.stripe_customer_id ? undefined : user.email,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    success_url: `${origin}/dashboard/billing?success=true`,
    cancel_url: `${origin}/dashboard/billing?canceled=true`,
    metadata: { planId, userId: user.id },
    subscription_data: { metadata: { planId, userId: user.id } },
  });

  return apiSuccess({ url: session.url });
});
