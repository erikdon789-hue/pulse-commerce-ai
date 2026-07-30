import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
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

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.client_reference_id) {
      const supabase = createServiceClient();
      await supabase.from("orders").upsert(
        {
          buyer_id: session.client_reference_id,
          stripe_checkout_session_id: session.id,
          status: "paid",
          total_cents: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
        },
        { onConflict: "stripe_checkout_session_id" },
      );
    }
  }

  return NextResponse.json({ received: true });
}
