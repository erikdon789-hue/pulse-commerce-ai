import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete } from "@/lib/pipeline/jobs";
import { fetchProductPage } from "@/lib/scrape/product";
import { apiSuccess, apiError, withRoute } from "@/lib/api/response";
import { getSupplierProvider } from "@/lib/suppliers/registry";
import type { NormalizedProduct, SupplierId } from "@/lib/suppliers/types";
import type { Json } from "@/types/database.types";

const VALID_SUPPLIERS: SupplierId[] = ["aliexpress", "alibaba", "cjdropshipping"];

function fromNormalizedProduct(product: NormalizedProduct) {
  return {
    source_url: product.sourceUrl,
    title: product.title,
    description: product.description,
    // store_products.price_cents is the COST basis (what we pay the
    // supplier), not the selling price — the pricing engine (content step)
    // derives the selling price from this.
    price_cents: Math.round(product.price.amount * 100),
    currency: product.price.currency.toLowerCase(),
    images: product.images,
    // The full normalized product (including the supplier's raw payload)
    // is kept here, not just the raw payload — this is the only place
    // supplier/supplierProductId/priceRange/minOrderQuantity survive once
    // it becomes a store_products row. Round-tripped through JSON since
    // NormalizedProduct's `raw: unknown` isn't structurally a Json type.
    raw_fetch_data: JSON.parse(JSON.stringify(product)) as Json,
  };
}

// Three modes in one route, keeping the pipeline at exactly the 9 planned
// steps instead of adding separate endpoints:
//   - { source_url } only          -> best-effort fetch, returns a preview,
//                                      does NOT write to the database yet
//   - { supplier, supplierProductId } -> live fetch from a configured
//                                      supplier provider (Phase 1), then
//                                      save immediately — the merchant
//                                      already saw the full product in the
//                                      "Find Winning Products" search
//                                      results, so no separate preview step
//                                      is needed here.
//   - { title, ... } present       -> confirm/save (manually entered, or
//                                      the user's edited version of the
//                                      URL-scrape preview)
export const POST = withRoute(
  async (request: Request, { params }: { params: Promise<{ storeId: string }> }) => {
    const { storeId } = await params;
    const guard = await requireStoreOwner(storeId);
    if (guard.error) return guard.error;
    const { supabase, store } = guard;

    const body = await request.json();

    if (body.source_url && !body.title) {
      const preview = await fetchProductPage(body.source_url);
      return apiSuccess({ preview });
    }

    let insertPayload: ReturnType<typeof fromNormalizedProduct>;

    if (body.supplier && body.supplierProductId) {
      if (!VALID_SUPPLIERS.includes(body.supplier)) {
        return apiError("VALIDATION_ERROR", `supplier must be one of: ${VALID_SUPPLIERS.join(", ")}`, {
          status: 400,
        });
      }

      const provider = getSupplierProvider(body.supplier as SupplierId);
      if (!provider?.isConfigured()) {
        return apiError("SUPPLIER_NOT_CONFIGURED", `${body.supplier} is not configured`, {
          status: 400,
        });
      }

      const product = await provider.getProduct(body.supplierProductId);
      if (!product) {
        return apiError("PRODUCT_NOT_FOUND", "Product not found", { status: 404 });
      }

      insertPayload = fromNormalizedProduct(product);
    } else {
      const { title, description, price_cents, currency, images, source_url, raw_fetch_data } =
        body;

      if (!title) {
        return apiError("VALIDATION_ERROR", "title is required", { status: 400 });
      }

      insertPayload = {
        source_url: source_url ?? null,
        title,
        description: description ?? null,
        price_cents: price_cents ?? null,
        currency: currency ?? "usd",
        images: images ?? [],
        raw_fetch_data: raw_fetch_data ?? null,
      };
    }

    const { data: storeProduct, error } = await supabase
      .from("store_products")
      .insert({ store_id: store.id, ...insertPayload })
      .select()
      .single();

    if (error) {
      return apiError("DATABASE_ERROR", error.message, { status: 500 });
    }

    await supabase.from("stores").update({ status: "building" }).eq("id", store.id);
    await markStepComplete(supabase, store.id, "ingest");

    return apiSuccess({ storeProduct }, { status: 201 });
  },
);
