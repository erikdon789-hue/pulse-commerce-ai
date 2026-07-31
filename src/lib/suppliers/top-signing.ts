import { createHmac } from "node:crypto";

// Request-signing scheme shared by Alibaba Group's "TOP"-style open
// platform gateways (AliExpress Open Platform, Alibaba.com Open Platform):
// sort every param (system + business) by key, concatenate as key+value
// pairs with no separator, HMAC-SHA256 with the app secret, uppercase hex.
export function signTopRequest(params: Record<string, string>, appSecret: string): string {
  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.map((key) => `${key}${params[key]}`).join("");
  return createHmac("sha256", appSecret).update(concatenated, "utf8").digest("hex").toUpperCase();
}

export function buildTopSystemParams(opts: { appKey: string; method: string }): Record<string, string> {
  return {
    app_key: opts.appKey,
    method: opts.method,
    timestamp: formatTopTimestamp(new Date()),
    format: "json",
    v: "2.0",
    sign_method: "sha256",
  };
}

function formatTopTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
