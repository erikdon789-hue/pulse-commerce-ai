# Pulse Commerce AI

An AI-powered e-commerce SaaS platform built with Next.js (App Router), TypeScript,
Tailwind CSS, Supabase, Stripe, and the OpenAI API.

## Stack

- **Next.js 16** (App Router, Turbopack by default) + TypeScript
- **Tailwind CSS v4**
- **Supabase** — Postgres, Auth, and Row Level Security
- **Stripe** — Checkout and billing webhooks
- **OpenAI API** — embeddings-based product recommendations and a chat assistant
- **Vercel** — target deployment platform

## Project structure

```
src/
  app/
    (marketing)/         # public site: / and /pricing
    (dashboard)/          # authenticated app shell at /dashboard/*
    api/
      checkout/            # POST -> creates a Stripe Checkout Session
      webhooks/stripe/      # POST -> Stripe webhook receiver
      ai/recommend/         # POST -> embedding-based product recommendations
      ai/chat/               # POST -> AI shopping assistant chat completion
  components/
    ui/                    # low-level primitives (Button, Card)
    marketing/, dashboard/  # feature-specific components
  lib/
    supabase/              # browser client, server client, service-role client,
                             # and the session-refresh helper used by src/proxy.ts
    stripe/, openai/        # server-side SDK instances
  types/                   # hand-written Supabase types (see note below)
  proxy.ts                 # Next.js 16's replacement for middleware.ts —
                             # refreshes the Supabase session and gates /dashboard
supabase/
  migrations/0001_init.sql  # profiles, products, orders, order_items + RLS + pgvector
```

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql`. It creates the core
   tables, enables Row Level Security, and adds a `match_products` function for
   vector similarity search (used by `/api/ai/recommend`).
3. From **Project Settings > API**, copy the Project URL, `anon` public key, and
   `service_role` secret key into `.env.local`.
4. Once you have a real project, regenerate typed database types:
   ```bash
   npx supabase gen types typescript --project-id <project-id> > src/types/database.types.ts
   ```
   (`src/types/database.types.ts` is currently hand-written to match the migration
   above — this command keeps it in sync as the schema evolves.)

### 2. Stripe

1. Grab your test-mode **Secret key** and **Publishable key** from
   [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) and add them
   to `.env.local`.
2. For local webhook testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
   and run:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In production, create a webhook endpoint in the Stripe dashboard pointing at
   `https://<your-domain>/api/webhooks/stripe` listening for `checkout.session.completed`.

### 3. OpenAI

Create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
and add it as `OPENAI_API_KEY` in `.env.local`.

### 4. Run locally

```bash
npm install   # already run during scaffolding
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Deploy to Vercel

1. Push this repository to GitHub.
2. Import it into [Vercel](https://vercel.com/new).
3. Add every variable from `.env.local.example` to the Vercel project's Environment
   Variables (Production and Preview).
4. After the first deploy, update the Stripe webhook endpoint and
   `NEXT_PUBLIC_SITE_URL` to point at the production domain.

## Notes

- `.env.local` currently contains placeholder values so the app builds and runs
  without real credentials. Product/order data won't load until you swap in real
  Supabase/Stripe/OpenAI keys.
- Route protection lives in `src/proxy.ts` — Next.js 16 renamed the `middleware.ts`
  convention to `proxy.ts`; the actual session-refresh logic is in
  `src/lib/supabase/proxy.ts`.
- `params` and `searchParams` are Promises throughout (Next.js 15+ convention),
  and Route Handler `context.params` follows the same pattern.
