import { z } from "zod";

// Structured-output schemas for each pipeline step. Passed to
// generateStructured() (lib/ai/generate.ts), which uses OpenAI's Responses
// API structured outputs so routes get typed, validated objects back instead
// of parsing freeform text.

export const productAnalysisSchema = z.object({
  viability_score: z.number().int().min(0).max(100),
  viability_reasoning: z.string(),
  target_audience: z.object({
    demographics: z.string(),
    psychographics: z.string(),
    pain_points: z.array(z.string()),
  }),
  competitors: z.array(
    z.object({
      name: z.string(),
      url: z.string().nullable(),
      differentiator: z.string(),
    }),
  ),
  positioning: z.string(),
  marketing_angles: z.array(z.string()),
});
export type ProductAnalysis = z.infer<typeof productAnalysisSchema>;

export const brandIdentitySchema = z.object({
  brand_name: z.string(),
  slogan: z.string(),
  colors: z.object({
    primary: z.string(),
    secondary: z.string(),
    accent: z.string(),
  }),
  fonts: z.object({
    heading: z.string(),
    body: z.string(),
  }),
  tone_of_voice: z.string(),
});
export type BrandIdentity = z.infer<typeof brandIdentitySchema>;

export const creativeBriefsSchema = z.object({
  logo_brief: z.string(),
  logo_image_prompt: z.string(),
  ad_banners: z.array(
    z.object({
      platform: z.enum(["tiktok", "instagram", "facebook"]),
      brief: z.string(),
      image_prompt: z.string(),
    }),
  ),
});
export type CreativeBriefs = z.infer<typeof creativeBriefsSchema>;

export const productContentSchema = z.object({
  title: z.string(),
  description: z.string(),
  benefits: z.array(z.string()),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  review_placeholders: z.array(
    z.object({
      reviewer_name: z.string(),
      rating: z.number().int().min(1).max(5),
      body: z.string(),
    }),
  ),
  pricing_strategy: z.object({
    suggested_price_cents: z.number().int(),
    compare_at_price_cents: z.number().int().nullable(),
    reasoning: z.string(),
  }),
  upsells: z.array(z.object({ name: z.string(), pitch: z.string() })),
});
export type ProductContent = z.infer<typeof productContentSchema>;

export const seoContentSchema = z.object({
  seo_title: z.string(),
  meta_description: z.string(),
  keywords: z.array(z.string()),
  collection_title: z.string(),
  collection_description: z.string(),
});
export type SeoContent = z.infer<typeof seoContentSchema>;

export const marketingContentSchema = z.object({
  hooks: z.array(z.string()),
  scripts: z.array(z.string()),
  captions: z.array(z.string()),
  banner_copy: z.array(z.string()),
});
export type MarketingContent = z.infer<typeof marketingContentSchema>;
