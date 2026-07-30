-- Pulse Commerce AI — initial schema
-- Run via `supabase db push` (Supabase CLI) or the SQL editor in the Supabase dashboard.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- One row per authenticated user, keyed to auth.users.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'usd',
  image_url text,
  stripe_price_id text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  stripe_checkout_session_id text unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'fulfilled', 'canceled')),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'usd',
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

-- Row Level Security: owners manage their own products, buyers see their own orders.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "Profiles are viewable by their owner" on public.profiles
  for select using (auth.uid() = id);

create policy "Profiles are editable by their owner" on public.profiles
  for update using (auth.uid() = id);

create policy "Products are publicly readable" on public.products
  for select using (true);

create policy "Products are managed by their owner" on public.products
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "Orders are viewable by their buyer" on public.orders
  for select using (auth.uid() = buyer_id);

create policy "Order items are viewable via their parent order" on public.order_items
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
      and orders.buyer_id = auth.uid()
    )
  );

-- Vector similarity search backing the AI recommendation endpoint
-- (src/app/api/ai/recommend/route.ts). Embeddings are 1536-dim to match
-- OpenAI's text-embedding-3-small model.
create or replace function public.match_products(
  query_embedding vector(1536),
  match_count int default 5
)
returns setof public.products
language sql
stable
as $$
  select *
  from public.products
  where embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
