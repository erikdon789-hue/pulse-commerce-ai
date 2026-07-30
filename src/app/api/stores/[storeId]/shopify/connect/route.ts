import { NextResponse } from "next/server";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete } from "@/lib/pipeline/jobs";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyShopifyCredentials } from "@/lib/shopify/client";

// Merchant pastes an Admin API access token from a Custom App they created
// in their own Shopify admin (Settings -> Apps -> Develop apps). We verify
// it works before saving, then store it via the service-role client only —
// shopify_connections has no RLS policies, so the regular per-request client
// can't write to it even for the owning user.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const guard = await requireStoreOwner(storeId);
  if (guard.error) return guard.error;
  const { supabase, store } = guard;

  const { shop_domain, access_token } = await request.json();

  if (!shop_domain || !access_token) {
    return NextResponse.json(
      { error: "shop_domain and access_token are required" },
      { status: 400 },
    );
  }

  try {
    const shop = await verifyShopifyCredentials(shop_domain, access_token);

    const serviceClient = createServiceClient();
    const { error } = await serviceClient.from("shopify_connections").upsert(
      {
        store_id: store.id,
        shop_domain: shop.myshopifyDomain,
        access_token,
        scopes: [],
      },
      { onConflict: "store_id" },
    );

    if (error) throw error;

    await supabase.from("stores").update({ status: "connected" }).eq("id", store.id);
    await markStepComplete(supabase, store.id, "shopify_connect");

    return NextResponse.json({ shop });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to connect the Shopify store";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
