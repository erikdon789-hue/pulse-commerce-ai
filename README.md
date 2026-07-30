# Pulse Commerce AI

An AI Shopify store builder. Give it a product idea or an Alibaba/AliExpress
link, and it analyzes viability, generates a brand identity and creative
assets, writes all product/SEO/ad copy, and pushes everything into your
existing Shopify store via the Admin API.

Built with Next.js (App Router), TypeScript, Tailwind CSS, Supabase, Stripe,
and the OpenAI API.

## Stack

- **Next.js 16** (App Router, Turbopack by default) + TypeScript
- **Tailwind CSS v4**
- **Supabase** — Postgres, Auth, Row Level Security, Storage
- **Stripe** — credit/subscription billing for using the builder
- **OpenAI API** — structured-output text generation (Responses API) + image
  generation for logos/creatives
- **Shopify Admin API** — pushes the generated store into a merchant's own
  Shopify store (via a Custom App access token, not OAuth)
- **Vercel** — target deployment platform

## How it works

1. `/dashboard/new` — paste a product idea or a product link. A best-effort
   fetch tries to prefill title/description/images from the link; you confirm
   or edit the details either way.
2. `/dashboard/[storeId]` — click **Run pipeline**. Each step is its own API
   route, called in sequence by the page:
   - `analyze` — viability score, target audience, competitors, positioning,
     marketing angles
   - `brand` — brand name, slogan, color palette, fonts, tone of voice
   - `creative` — logo + ad creative briefs, with actual images generated via
     OpenAI and stored in Supabase Storage
   - `content` — product title/description/benefits/FAQs/review
     placeholders/pricing strategy/upsells
   - `seo` — SEO title/meta description/keywords + collection page copy
   - `marketing` — TikTok/Instagram Reels/Facebook hooks, scripts, captions,
     banner copy
3. `/dashboard/[storeId]/shopify` — paste a Shopify Custom App Admin API
   access token, then push the collection/product/content into that store.

## Project structure

```
src/
  app/
    (marketing)/                    # public site: / and /pricing
    (dashboard)/dashboard/
      page.tsx                       # list of your store-builder projects
      new/page.tsx                    # idea/link intake wizard
      [storeId]/page.tsx               # pipeline progress + result tabs
      [storeId]/shopify/page.tsx        # connect + push to Shopify
      billing/page.tsx                  # credits balance + plans
    api/
      stores/route.ts                 # create/list stores (reserves 1 credit)
      stores/[storeId]/route.ts        # aggregate store detail
      stores/[storeId]/{ingest,analyze,brand,creative,content,seo,marketing}/
                                        # the 7 content-generation pipeline steps
      stores/[storeId]/shopify/{connect,push}/
                                        # connect a Shopify store, then push to it
      checkout/route.ts                # Stripe Checkout for credit plans
      webhooks/stripe/route.ts          # grants credits on payment
  components/
    ui/                              # low-level primitives (Button, Card)
    marketing/, dashboard/            # feature-specific components
  lib/
    supabase/                        # browser/server/service clients, storage
                                       # helper, and the proxy session-refresh
                                       # helper used by src/proxy.ts
    ai/                               # structured-output generation (zod +
                                       # OpenAI Responses API), image generation
    shopify/                         # thin fetch-based Admin GraphQL client
    scrape/                          # best-effort product-page fetch (no
                                       # anti-bot evasion; manual entry is the
                                       # reliable fallback)
    pipeline/                        # shared route helpers: ownership guard,
                                       # build_jobs tracking, store-detail query
    stripe/plans.ts                   # credit/subscription plan definitions
  types/                             # hand-written Supabase types (see note)
  proxy.ts                           # Next.js 16's replacement for
                                       # middleware.ts — refreshes the Supabase
                                       # session and gates /dashboard
supabase/
  migrations/
    0001_init.sql                     # superseded — see 0002
    0002_store_builder.sql            # current schema: stores, store_products,
                                        # product_analysis, brand_identity,
                                        # creative_assets, product_content,
                                        # seo_content, marketing_content,
                                        # shopify_connections, build_jobs,
                                        # credit_ledger + RLS + storage bucket
```

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0002_store_builder.sql` (it
   supersedes `0001_init.sql`, dropping the old storefront tables and creating
   the store-builder schema, including a public `creative-assets` storage
   bucket for generated logos/ad images).
3. From **Project Settings > API**, copy the Project URL, publishable key, and
   secret key into `.env.local` (`NEXT_PUBLIC_SUPABASE_ANON_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` — Supabase's newer "Publishable"/"Secret" key
   naming maps directly onto those same slots).
4. If new tables don't show up via the Data API after running the migration,
   this project needed an explicit grants block to make that work (see the
   trailing comment in `0001_init.sql`) — run it again against the new tables
   if you hit `PGRST205` errors.
5. Once you have a real project, regenerate typed database types:
   ```bash
   npx supabase gen types typescript --project-id <project-id> > src/types/database.types.ts
   ```

### 2. Stripe

1. Grab your test-mode **Secret key** and **Publishable key** from
   [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) and add
   them to `.env.local`.
2. In the Stripe Dashboard's product catalog, create three recurring Prices
   (Starter/Growth/Scale, or whatever tiers you want) and put their price IDs
   in `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_SCALE`.
3. For local webhook testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
   and run:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
4. In production, create a webhook endpoint pointing at
   `https://<your-domain>/api/webhooks/stripe` listening for
   `checkout.session.completed` and `invoice.payment_succeeded`.

### 3. OpenAI

Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
and add it as `OPENAI_API_KEY` in `.env.local`. Default models
(`gpt-5.4` for text, `gpt-image-1.5` for images) are overridable via
`OPENAI_TEXT_MODEL` / `OPENAI_IMAGE_MODEL`.

### 4. Shopify

No app registration needed for v1 — each merchant creates their own access:
in their Shopify admin, **Settings → Apps → Develop apps → Create an app**,
grant it `write_products` and `write_content` scopes, install it, and paste
the generated Admin API access token into `/dashboard/[storeId]/shopify` in
this app.

### 5. Run locally

```bash
npm install   # already run during scaffolding
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Deploy to Vercel

1. Push this repository to GitHub.
2. Import it into [Vercel](https://vercel.com/new).
3. Add every variable from `.env.local.example` to the Vercel project's
   Environment Variables (Production and Preview).
4. After the first deploy, update the Stripe webhook endpoint and
   `NEXT_PUBLIC_SITE_URL` to point at the production domain.

## Known gaps / follow-ups

- **No auth UI yet.** `src/proxy.ts` gates `/dashboard/*` on a Supabase
  session existing, but there's no sign-up/sign-in page in this scaffold —
  wire up Supabase Auth UI (email/password or OAuth) next.
- **Alibaba/AliExpress ingestion is best-effort only.** These sites are
  heavily bot-protected; expect the automated fetch to fail often and rely on
  the manual confirm/edit form in `/dashboard/new`.

## Notes

- `.env.local` currently contains placeholder values so the app builds and
  runs without real credentials. Pipeline steps won't produce real output
  until you swap in real Supabase/Stripe/OpenAI keys.
- `shopify_connections` has Row Level Security enabled with **no policies at
  all** — only the service-role client (server-only) can read/write it, since
  it holds a live Shopify Admin API token.
- Route protection lives in `src/proxy.ts` — Next.js 16 renamed the
  `middleware.ts` convention to `proxy.ts`; the session-refresh logic itself
  is in `src/lib/supabase/proxy.ts`.
- `params` and `searchParams` are Promises throughout (Next.js 15+
  convention), and Route Handler `context.params` follows the same pattern.
