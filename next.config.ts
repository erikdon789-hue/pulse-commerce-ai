import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the Shopify CLI's Cloudflare quick tunnel (a new random subdomain
  // each session) reach the dev server — otherwise Next blocks cross-origin
  // dev requests (including the HMR websocket) and the tunnel destabilizes.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
