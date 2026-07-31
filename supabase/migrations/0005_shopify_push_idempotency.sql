-- shopify/push/route.ts had no record of a product already having been
-- pushed, so a retried request, a double-click, or the client re-submitting
-- after a slow response would create a second, duplicate product (and
-- collection) in the merchant's real Shopify store on every call. These
-- columns let the route short-circuit to the existing result instead of
-- creating a new one when the current product has already been pushed.
alter table public.store_products
  add column if not exists shopify_product_id text,
  add column if not exists shopify_product_handle text,
  add column if not exists shopify_collection_id text,
  add column if not exists shopify_collection_handle text;
