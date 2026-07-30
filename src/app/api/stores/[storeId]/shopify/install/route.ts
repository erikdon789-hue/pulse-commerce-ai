import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { isValidShopDomain, buildAuthorizeUrl, getPublicOrigin } from "@/lib/shopify/oauth";

const STATE_COOKIE = "shopify_oauth_state";

// GET so a plain HTML <form method="GET"> can drive this — no client JS,
// no cross-origin-redirect-via-fetch awkwardness. storeId travels via the
// URL here (same-site call); it travels via the state cookie on the way
// back through Shopify, since /api/shopify/oauth/callback is a single fixed
// path shared by every store (it's the one URL on Shopify's allow-list).
//
// This is a browser navigation, not a JSON API route — errors redirect with
// an ?error= code (read by the shopify connect page) rather than using the
// apiSuccess/apiError JSON envelope the rest of the API uses.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const origin = getPublicOrigin(request);

  try {
    const guard = await requireStoreOwner(storeId);
    if (guard.error) {
      return NextResponse.redirect(
        guard.error.status === 401
          ? `${origin}/login`
          : `${origin}/dashboard?error=store_not_found`,
      );
    }

    const shop = new URL(request.url).searchParams.get("shop")?.trim().toLowerCase();
    const dashboardUrl = `${origin}/dashboard/${storeId}/shopify`;
    if (!shop || !isValidShopDomain(shop)) {
      return NextResponse.redirect(`${dashboardUrl}?error=invalid_shop`);
    }

    const nonce = randomUUID();
    // Derived from the live request's own origin, not a static env var — under
    // `shopify app dev` this is the CLI-managed tunnel's https URL.
    const redirectUri = `${origin}/api/shopify/oauth/callback`;

    const authorizeUrl = buildAuthorizeUrl({
      shop,
      apiKey: process.env.SHOPIFY_API_KEY!,
      scopes: process.env.SHOPIFY_SCOPES ?? "write_products,write_content",
      redirectUri,
      state: nonce,
    });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(STATE_COOKIE, `${nonce}:${storeId}`, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 5,
    });
    return response;
  } catch (err) {
    console.error(`[shopify/install] ${storeId} failed:`, err);
    return NextResponse.redirect(
      `${origin}/dashboard/${storeId}/shopify?error=install_failed`,
    );
  }
}
