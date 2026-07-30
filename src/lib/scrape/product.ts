import * as cheerio from "cheerio";

export interface ScrapedProduct {
  title: string | null;
  description: string | null;
  images: string[];
  price: string | null;
}

// Best-effort only: a plain server-side fetch + standard og:*/meta parsing,
// no anti-bot evasion. Alibaba/AliExpress product pages are frequently
// JS-rendered or bot-walled, so this is expected to fail often — callers
// must fall back to a manual entry form when it returns null.
export async function fetchProductPage(url: string): Promise<ScrapedProduct | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PulseCommerceAIBot/1.0)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr("content") ??
      $("title").first().text() ??
      null;

    const description =
      $('meta[property="og:description"]').attr("content") ??
      $('meta[name="description"]').attr("content") ??
      null;

    const images = $('meta[property="og:image"]')
      .map((_, el) => $(el).attr("content"))
      .get()
      .filter((src): src is string => Boolean(src));

    const price =
      $('meta[property="product:price:amount"]').attr("content") ??
      $('meta[property="og:price:amount"]').attr("content") ??
      null;

    const cleanTitle = title?.trim() || null;
    if (!cleanTitle && images.length === 0) {
      // Fetch succeeded but yielded nothing usable (bot wall, JS-only
      // content, etc.) — treat as a failed fetch so the caller falls back.
      return null;
    }

    return {
      title: cleanTitle,
      description: description?.trim() || null,
      images,
      price,
    };
  } catch {
    // Network error, timeout, non-HTML response, etc. — expected for these
    // sites; caller falls back to manual entry.
    return null;
  }
}
