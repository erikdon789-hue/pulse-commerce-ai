-- The creative pipeline step used to generate the AI brief and all 4 images
-- in one request, which reliably exceeded Netlify's ~30s proxy inactivity
-- timeout (confirmed by direct production reproduction — see
-- src/app/api/stores/[storeId]/creative/route.ts). Splitting it into two
-- independently-invoked steps (brief, then images) needs the brief
-- persisted so the second step can resume without re-running the first
-- step's LLM call.
alter table public.brand_identity
  add column if not exists creative_brief jsonb;

-- creative_assets had no constraint preventing a retried image-generation
-- request from creating duplicate rows (a second logo, a second Instagram
-- banner, etc) for the same store. Partial unique indexes because
-- `platform` is null for the logo row — an ordinary unique index over
-- (store_id, type, platform) would not reject a second null-platform logo
-- row, since SQL treats NULL <> NULL.
create unique index if not exists creative_assets_unique_logo
  on public.creative_assets (store_id)
  where type = 'logo';

create unique index if not exists creative_assets_unique_banner
  on public.creative_assets (store_id, platform)
  where type = 'ad_banner';
