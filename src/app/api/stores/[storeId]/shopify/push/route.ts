import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete, markJobFailed } from "@/lib/pipeline/jobs";
import { createServiceClient } from "@/lib/supabase/service";
import {
  createShopifyAdminClient,
  createShopifyCollection,
  createShopifyProduct,
} from "@/lib/shopify/client";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import type { Json } from "@/types/database.types";

interface PricingStrategy {
  suggested_price_cents: number;
}

interface Faq {
  question: string;
  answer: string;
}

function buildProductDescriptionHtml(
  description: string,
  benefits: Json,
  faqs: Json,
): string {
  const benefitItems = ((benefits as unknown as string[]) ?? [])
    .map((benefit) => `<li>${benefit}</li>`)
    .join("");
  const faqItems = ((faqs as unknown as Faq[]) ?? [])
    .map((faq) => `<p><strong>${faq.question}</strong><br/>${faq.answer}</p>`)
    .join("");

  return [
    `<p>${description}</p>`,
    benefitItems ? `<h3>Benefits</h3><ul>${benefitItems}</ul>` : "",
    faqItems ? `<h3>FAQs</h3>${faqItems}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const POST = withRoute(
  async (_request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const serviceClient = createServiceClient();
    const { data: connection } = await serviceClient
      .from("shopify_connections")
      .select("*")
      .eq("store_id", storeId)
      .maybeSingle();

    if (!connection) {
      return apiError("SHOPIFY_NOT_CONNECTED", "Connect a Shopify store first", {
        status: 400,
      });
    }

    const { data: product } = await supabase
      .from("store_products")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: content } = product
      ? await supabase
          .from("product_content")
          .select("*")
          .eq("store_product_id", product.id)
          .maybeSingle()
      : { data: null };

    const { data: seo } = product
      ? await supabase
          .from("seo_content")
          .select("*")
          .eq("store_product_id", product.id)
          .maybeSingle()
      : { data: null };

    if (!product || !content) {
      return apiError("PIPELINE_STEP_MISSING", "Run the content step first", { status: 400 });
    }

    try {
      const client = createShopifyAdminClient(connection.shop_domain, connection.access_token);

      const collection = await createShopifyCollection(client, {
        title: store.collection_title ?? `${store.name} Collection`,
        descriptionHtml: `<p>${store.collection_description ?? ""}</p>`,
      });

      const pricingStrategy = content.pricing_strategy as unknown as PricingStrategy;

      const shopifyProduct = await createShopifyProduct(client, {
        title: content.title,
        descriptionHtml: buildProductDescriptionHtml(
          content.description,
          content.benefits,
          content.faqs,
        ),
        priceAmount: pricingStrategy.suggested_price_cents / 100,
        currencyCode: product.currency.toUpperCase(),
        images: (product.images as unknown as string[]) ?? [],
        tags: (seo?.keywords as unknown as string[]) ?? [],
      });

      await supabase.from("stores").update({ status: "launched" }).eq("id", store.id);
      await markStepComplete(supabase, store.id, "shopify_push");

      return apiSuccess({ collection, product: shopifyProduct });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Shopify push failed";
      await markJobFailed(supabase, store.id, message);
      return apiError("SHOPIFY_ERROR", message, { status: 500 });
    }
  },
);
