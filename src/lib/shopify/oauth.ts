import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

// `request.url` reflects the raw incoming connection (e.g. localhost:3000),
// not the public hostname a reverse proxy/tunnel was reached through — Next
// doesn't rewrite it from forwarded headers. Prefer x-forwarded-host/proto
// (set by cloudflared and effectively every proxy) and fall back to the
// request's own origin for direct/non-proxied requests.
export function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

// Guards against SSRF via a malformed `shop` param before any fetch touches it.
export function isValidShopDomain(shop: string): boolean {
  return SHOP_DOMAIN_RE.test(shop);
}

export function buildAuthorizeUrl(opts: {
  shop: string;
  apiKey: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`https://${opts.shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", opts.apiKey);
  url.searchParams.set("scope", opts.scopes);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

// Shopify's documented OAuth-callback HMAC check: drop hmac/signature, sort
// remaining params, join as key=value pairs with & (escaping literal % and &
// first), HMAC-SHA256 hex with the app's client secret, timing-safe compare.
export function verifyOAuthHmac(searchParams: URLSearchParams, apiSecret: string): boolean {
  const hmac = searchParams.get("hmac");
  if (!hmac) return false;

  const escape = (s: string) => s.replace(/%/g, "%25").replace(/&/g, "%26");
  const pairs: string[] = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${escape(key)}=${escape(value)}`);
  }
  pairs.sort();

  const digest = createHmac("sha256", apiSecret).update(pairs.join("&")).digest("hex");
  const digestBuf = Buffer.from(digest, "utf8");
  const hmacBuf = Buffer.from(hmac, "utf8");
  if (digestBuf.length !== hmacBuf.length) return false;
  return timingSafeEqual(digestBuf, hmacBuf);
}

export async function exchangeCodeForAccessToken(opts: {
  shop: string;
  code: string;
  apiKey: string;
  apiSecret: string;
}): Promise<{ access_token: string; scope: string }> {
  const response = await fetch(`https://${opts.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: opts.apiKey,
      client_secret: opts.apiSecret,
      code: opts.code,
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Shopify token exchange failed (${response.status}): ${body}`);
  }
  return response.json();
}
