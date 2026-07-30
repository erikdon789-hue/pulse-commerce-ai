import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";
import { PLANS, planIdForPriceId } from "@/lib/stripe/plans";
import { withRoute } from "@/lib/api/response";

type ServiceClient = ReturnType<typeof createServiceClient>;

async function grantCredits(
  supabase: ServiceClient,
  userId: string,
  amount: number,
  stripeEventId: string,
) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", userId)
    .single();

  if (!profile) return;

  await supabase
    .from("profiles")
    .update({ credits_balance: profile.credits_balance + amount })
    .eq("id", userId);

  await supabase.from("credit_ledger").insert({
    owner_id: userId,
    amount,
    reason: "subscription_grant",
    stripe_event_id: stripeEventId,
  });
}

export const POST = withRoute(async (request: Request) => {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id ?? session.metadata?.userId;
    const planId = session.metadata?.planId as keyof typeof PLANS | undefined;

    if (userId && planId && PLANS[planId]) {
      await grantCredits(supabase, userId, PLANS[planId].credits, event.id);

      if (session.customer) {
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: session.customer as string })
          .eq("id", userId);
      }
    }
  }

  // Recurring renewal — grant the plan's monthly credits again each cycle.
  // Skip the very first invoice, since checkout.session.completed above
  // already granted credits for it.
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object as Stripe.Invoice;
    const isFirstInvoice = invoice.billing_reason === "subscription_create";

    if (!isFirstInvoice) {
      const line = invoice.lines.data[0];
      const priceId = line?.pricing?.price_details?.price;
      const priceIdString = typeof priceId === "string" ? priceId : priceId?.id;
      const planId = priceIdString ? planIdForPriceId(priceIdString) : null;
      const userId = line?.metadata?.userId;

      if (planId && userId) {
        await grantCredits(supabase, userId, PLANS[planId].credits, event.id);
      }
    }
  }

  return NextResponse.json({ received: true });
});
