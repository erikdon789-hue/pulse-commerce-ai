-- Pulse Commerce AI → AI Shopify Store Builder pivot.
-- Drops the old generic-storefront schema and replaces it with the
-- store-builder pipeline schema. Run in the SQL Editor, then:
--   grant usage on schema public to anon, authenticated, service_role;
--   grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
--   grant select on all tables in schema public to anon;
--   grant usage, select on all sequences in schema public to anon, authenticated, service_role;
--   grant execute on all functions in schema public to anon, authenticated, service_role;
--   notify pgrst, 'reload schema';
-- (see 0001_init.sql's grant block — Data API access needs these regardless
-- of "automatically expose new tables" in this project.)

drop function if exists public.match_products(vector, int);
drop table if exists public.order_items;
drop table if exists public.orders;
drop table if exists public.products;

alter table public.profiles
  add column if not exists credits_balance integer not null default 0;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('idea', 'link')),
  source_input text not null,
  status text not null default 'draft' check (
    status in ('draft', 'building', 'ready', 'connected', 'launched', 'failed')
  ),
  collection_title text,
  collection_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  source_url text,
  title text not null,
  description text,
  price_cents integer check (price_cents >= 0),
  currency text not null default 'usd',
  images jsonb not null default '[]'::jsonb,
  raw_fetch_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.product_analysis (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  viability_score integer not null check (viability_score between 0 and 100),
  viability_reasoning text not null,
  target_audience jsonb not null default '{}'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  positioning text not null,
  marketing_angles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.brand_identity (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  brand_name text not null,
  slogan text not null,
  colors jsonb not null default '{}'::jsonb,
  fonts jsonb not null default '{}'::jsonb,
  tone_of_voice text,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  type text not null check (type in ('logo', 'ad_banner', 'social_ad')),
  platform text check (platform in ('tiktok', 'instagram', 'facebook')),
  brief_text text not null,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_content (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null unique references public.store_products (id) on delete cascade,
  title text not null,
  description text not null,
  benefits jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb,
  review_placeholders jsonb not null default '[]'::jsonb,
  pricing_strategy jsonb not null default '{}'::jsonb,
  upsells jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.seo_content (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null unique references public.store_products (id) on delete cascade,
  seo_title text not null,
  meta_description text not null,
  keywords jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_content (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram_reels', 'facebook')),
  hooks jsonb not null default '[]'::jsonb,
  scripts jsonb not null default '[]'::jsonb,
  captions jsonb not null default '[]'::jsonb,
  banner_copy jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (store_id, platform)
);

-- Holds a live Shopify Admin API token. Intentionally has NO RLS policies —
-- only the service-role client (server-only) ever reads/writes this table.
create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  shop_domain text not null,
  access_token text not null,
  scopes jsonb not null default '[]'::jsonb,
  connected_at timestamptz not null default now()
);

create table if not exists public.build_jobs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  current_step text,
  steps_completed jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null,
  reason text not null check (reason in ('subscription_grant', 'store_build', 'purchase')),
  stripe_event_id text,
  created_at timestamptz not null default now()
);

alter table public.stores enable row level security;
alter table public.store_products enable row level security;
alter table public.product_analysis enable row level security;
alter table public.brand_identity enable row level security;
alter table public.creative_assets enable row level security;
alter table public.product_content enable row level security;
alter table public.seo_content enable row level security;
alter table public.marketing_content enable row level security;
alter table public.build_jobs enable row level security;
alter table public.credit_ledger enable row level security;
-- shopify_connections deliberately left with RLS enabled and zero policies:
-- enabling RLS with no policies blocks all access via anon/authenticated,
-- while service_role (used only server-side) bypasses RLS entirely.
alter table public.shopify_connections enable row level security;

create policy "Owners manage their own stores" on public.stores
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Owners manage their store products" on public.store_products
  for all using (
    exists (select 1 from public.stores where stores.id = store_products.store_id and stores.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.stores where stores.id = store_products.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners manage their product analysis" on public.product_analysis
  for all using (
    exists (select 1 from public.stores where stores.id = product_analysis.store_id and stores.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.stores where stores.id = product_analysis.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners manage their brand identity" on public.brand_identity
  for all using (
    exists (select 1 from public.stores where stores.id = brand_identity.store_id and stores.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.stores where stores.id = brand_identity.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners manage their creative assets" on public.creative_assets
  for all using (
    exists (select 1 from public.stores where stores.id = creative_assets.store_id and stores.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.stores where stores.id = creative_assets.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners manage their product content" on public.product_content
  for all using (
    exists (
      select 1 from public.store_products
      join public.stores on stores.id = store_products.store_id
      where store_products.id = product_content.store_product_id and stores.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.store_products
      join public.stores on stores.id = store_products.store_id
      where store_products.id = product_content.store_product_id and stores.owner_id = auth.uid()
    )
  );

create policy "Owners manage their seo content" on public.seo_content
  for all using (
    exists (
      select 1 from public.store_products
      join public.stores on stores.id = store_products.store_id
      where store_products.id = seo_content.store_product_id and stores.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.store_products
      join public.stores on stores.id = store_products.store_id
      where store_products.id = seo_content.store_product_id and stores.owner_id = auth.uid()
    )
  );

create policy "Owners manage their marketing content" on public.marketing_content
  for all using (
    exists (select 1 from public.stores where stores.id = marketing_content.store_id and stores.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.stores where stores.id = marketing_content.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners view their build jobs" on public.build_jobs
  for select using (
    exists (select 1 from public.stores where stores.id = build_jobs.store_id and stores.owner_id = auth.uid())
  );

create policy "Owners view their credit ledger" on public.credit_ledger
  for select using (auth.uid() = owner_id);

-- Keep stores.updated_at current on every write.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_stores_updated_at on public.stores;
create trigger set_stores_updated_at
  before update on public.stores
  for each row
  execute function public.set_updated_at();

-- Public bucket for AI-generated creative assets (logos, ad banners).
-- Public read is required because Shopify's productCreateMedia /
-- brand_identity.logo_url need a URL Shopify can fetch from directly.
insert into storage.buckets (id, name, public)
values ('creative-assets', 'creative-assets', true)
on conflict (id) do nothing;
