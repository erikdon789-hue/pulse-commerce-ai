import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { productId, quantity = 1 } = await request.json();

  if (!productId) {
    return NextResponse.json(
      { error: "productId is required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", productId)
    .single();

  if (error || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: user.id,
    line_items: [
      product.stripe_price_id
        ? { price: product.stripe_price_id, quantity }
        : {
            price_data: {
              currency: product.currency,
              product_data: { name: product.name },
              unit_amount: product.price_cents,
            },
            quantity,
          },
    ],
    success_url: `${origin}/dashboard/orders?success=true`,
    cancel_url: `${origin}/dashboard/products?canceled=true`,
    metadata: { productId: product.id },
  });

  return NextResponse.json({ url: session.url });
}
