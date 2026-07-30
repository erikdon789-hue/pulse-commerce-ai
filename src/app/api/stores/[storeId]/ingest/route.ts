import { NextResponse } from "next/server";
import { requireStoreOwner } from "@/lib/pipeline/guard";
import { markStepComplete } from "@/lib/pipeline/jobs";
import { fetchProductPage } from "@/lib/scrape/product";

// Two modes in one route, keeping the pipeline at exactly the 9 planned
// steps instead of adding a separate "preview" endpoint:
//   - { source_url } only        -> best-effort fetch, returns a preview,
//                                    does NOT write to the database yet
//   - { title, ... } present     -> confirm/save (manually entered, or the
//                                    user's edited version of the preview)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params;
  const guard = await requireStoreOwner(storeId);
  if (guard.error) return guard.error;
  const { supabase, store } = guard;

  const body = await request.json();

  if (body.source_url && !body.title) {
    const preview = await fetchProductPage(body.source_url);
    return NextResponse.json({ preview });
  }

  const { title, description, price_cents, currency, images, source_url, raw_fetch_data } = body;

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data: storeProduct, error } = await supabase
    .from("store_products")
    .insert({
      store_id: store.id,
      source_url: source_url ?? null,
      title,
      description: description ?? null,
      price_cents: price_cents ?? null,
      currency: currency ?? "usd",
      images: images ?? [],
      raw_fetch_data: raw_fetch_data ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("stores").update({ status: "building" }).eq("id", store.id);
  await markStepComplete(supabase, store.id, "ingest");

  return NextResponse.json({ storeProduct }, { status: 201 });
}
