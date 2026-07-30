import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete } from "@/lib/pipeline/jobs";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyShopifyCredentials } from "@/lib/shopify/client";
import {
  isValidShopDomain,
  verifyOAuthHmac,
  exchangeCodeForAccessToken,
  getPublicOrigin,
} from "@/lib/shopify/oauth";

const STATE_COOKIE = "shopify_oauth_state";

// Fixed single path — this is the one URL registered on Shopify's redirect
// allow-list, shared by every store. storeId travels via the state cookie
// set in install/route.ts, not the URL.
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const { searchParams } = new URL(request.url);

  function fail(storeId: string | null, code: string) {
    const target = storeId ? `${origin}/dashboard/${storeId}/shopify` : `${origin}/dashboard`;
    const response = NextResponse.redirect(`${target}?error=${code}`);
    response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }

  let storeId: string | null = null;

  try {
    const stateCookieValue = (await cookies()).get(STATE_COOKIE)?.value ?? "";
    const [nonce, parsedStoreId] = stateCookieValue.split(":");
    storeId = parsedStoreId ?? null;
    const state = searchParams.get("state");

    if (!nonce || !storeId || state !== nonce) {
      return fail(storeId, "state_mismatch");
    }

    const shop = searchParams.get("shop");
    const code = searchParams.get("code");
    if (!shop || !code || !isValidShopDomain(shop)) {
      return fail(storeId, "invalid_callback");
    }

    if (!verifyOAuthHmac(searchParams, process.env.SHOPIFY_API_SECRET!)) {
      return fail(storeId, "hmac_invalid");
    }

    const guard = await requireStoreOwner(storeId);
    if (guard.error) return fail(storeId, "not_authenticated");
    const { supabase, store } = guard;

    const { access_token, scope } = await exchangeCodeForAccessToken({
      shop,
      code,
      apiKey: process.env.SHOPIFY_API_KEY!,
      apiSecret: process.env.SHOPIFY_API_SECRET!,
    });

    const shopInfo = await verifyShopifyCredentials(shop, access_token);

    const serviceClient = createServiceClient();
    const { error } = await serviceClient.from("shopify_connections").upsert(
      {
        store_id: store.id,
        shop_domain: shopInfo.myshopifyDomain,
        access_token,
        scopes: scope ? scope.split(",") : [],
      },
      { onConflict: "store_id" },
    );
    if (error) throw error;

    await supabase.from("stores").update({ status: "connected" }).eq("id", store.id);
    await markStepComplete(supabase, store.id, "shopify_connect");

    const response = NextResponse.redirect(
      `${origin}/dashboard/${storeId}/shopify?shop=${encodeURIComponent(shopInfo.myshopifyDomain)}`,
    );
    response.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    console.error(`[shopify/oauth/callback] ${storeId ?? "unknown store"} failed:`, err);
    return fail(storeId, "connect_failed");
  }
}
