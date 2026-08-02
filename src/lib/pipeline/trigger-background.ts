import { getPublicOrigin } from "@/lib/shopify/oauth";

// Fires a Netlify Background Function (netlify/functions/<name>.ts, deployed
// name must end in "-background" for Netlify to invoke it asynchronously —
// see netlify.toml). Netlify's edge acks a background invocation almost
// immediately without waiting for the handler to finish, so this resolves
// fast regardless of how long the actual work takes; the caller must not
// rely on anything in the (unused) response.
//
// Needed because this app's synchronous request/response routes are capped
// by the Netlify plan's function timeout, which is shorter than a single
// OpenAI image generation call reliably takes — confirmed by direct
// production reproduction (see git history on
// src/app/api/stores/[storeId]/creative_logo/route.ts). Background
// Functions get up to 15 minutes, decoupled from the request that starts
// them; the frontend polls a status endpoint instead of awaiting one
// response (see src/components/dashboard/store-builder.tsx).
export async function triggerBackgroundFunction(
  request: Request,
  functionName: string,
  body: Record<string, unknown>,
): Promise<void> {
  const secret = process.env.INTERNAL_TRIGGER_SECRET;
  if (!secret) {
    throw new Error(
      `INTERNAL_TRIGGER_SECRET is not configured — cannot trigger ${functionName}`,
    );
  }

  const origin = getPublicOrigin(request);
  const res = await fetch(`${origin}/.netlify/functions/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-trigger-secret": secret,
    },
    body: JSON.stringify(body),
  });

  // A background function ack is a 202 (or 200) with an empty/ignored body —
  // anything else means the trigger request itself never reached it (wrong
  // secret, function not deployed, routing issue), which is worth failing
  // loudly on rather than silently telling the client "started".
  if (!res.ok) {
    throw new Error(
      `Failed to trigger background function ${functionName}: HTTP ${res.status}`,
    );
  }
}
