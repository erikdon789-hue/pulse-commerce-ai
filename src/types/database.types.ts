// Hand-written to match supabase/migrations/0001_init.sql + 0002_store_builder.sql.
// Once you have live, working Data API access, regenerate with:
//   npx supabase gen types typescript --project-id <project-id> > src/types/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          stripe_customer_id: string | null;
          credits_balance: number;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          stripe_customer_id?: string | null;
          credits_balance?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          stripe_customer_id?: string | null;
          credits_balance?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          source_type: "idea" | "link";
          source_input: string;
          status: "draft" | "building" | "ready" | "connected" | "launched" | "failed";
          collection_title: string | null;
          collection_description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          source_type: "idea" | "link";
          source_input: string;
          status?: "draft" | "building" | "ready" | "connected" | "launched" | "failed";
          collection_title?: string | null;
          collection_description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          source_type?: "idea" | "link";
          source_input?: string;
          status?: "draft" | "building" | "ready" | "connected" | "launched" | "failed";
          collection_title?: string | null;
          collection_description?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stores_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      store_products: {
        Row: {
          id: string;
          store_id: string;
          source_url: string | null;
          title: string;
          description: string | null;
          price_cents: number | null;
          currency: string;
          images: Json;
          raw_fetch_data: Json | null;
          shopify_product_id: string | null;
          shopify_product_handle: string | null;
          shopify_collection_id: string | null;
          shopify_collection_handle: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          source_url?: string | null;
          title: string;
          description?: string | null;
          price_cents?: number | null;
          currency?: string;
          images?: Json;
          raw_fetch_data?: Json | null;
          shopify_product_id?: string | null;
          shopify_product_handle?: string | null;
          shopify_collection_id?: string | null;
          shopify_collection_handle?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          source_url?: string | null;
          title?: string;
          description?: string | null;
          price_cents?: number | null;
          currency?: string;
          images?: Json;
          raw_fetch_data?: Json | null;
          shopify_product_id?: string | null;
          shopify_product_handle?: string | null;
          shopify_collection_id?: string | null;
          shopify_collection_handle?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "store_products_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      product_analysis: {
        Row: {
          id: string;
          store_id: string;
          viability_score: number;
          viability_reasoning: string;
          target_audience: Json;
          competitors: Json;
          positioning: string;
          marketing_angles: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          viability_score: number;
          viability_reasoning: string;
          target_audience?: Json;
          competitors?: Json;
          positioning: string;
          marketing_angles?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          viability_score?: number;
          viability_reasoning?: string;
          target_audience?: Json;
          competitors?: Json;
          positioning?: string;
          marketing_angles?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_analysis_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_identity: {
        Row: {
          id: string;
          store_id: string;
          brand_name: string;
          slogan: string;
          colors: Json;
          fonts: Json;
          tone_of_voice: string | null;
          logo_url: string | null;
          creative_brief: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          brand_name: string;
          slogan: string;
          colors?: Json;
          fonts?: Json;
          tone_of_voice?: string | null;
          logo_url?: string | null;
          creative_brief?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          brand_name?: string;
          slogan?: string;
          colors?: Json;
          fonts?: Json;
          tone_of_voice?: string | null;
          logo_url?: string | null;
          creative_brief?: Json | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_identity_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      creative_assets: {
        Row: {
          id: string;
          store_id: string;
          type: "logo" | "ad_banner" | "social_ad";
          platform: "tiktok" | "instagram" | "facebook" | null;
          brief_text: string;
          image_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          type: "logo" | "ad_banner" | "social_ad";
          platform?: "tiktok" | "instagram" | "facebook" | null;
          brief_text: string;
          image_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          type?: "logo" | "ad_banner" | "social_ad";
          platform?: "tiktok" | "instagram" | "facebook" | null;
          brief_text?: string;
          image_url?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "creative_assets_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      product_content: {
        Row: {
          id: string;
          store_product_id: string;
          title: string;
          description: string;
          benefits: Json;
          faqs: Json;
          review_placeholders: Json;
          pricing_strategy: Json;
          upsells: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_product_id: string;
          title: string;
          description: string;
          benefits?: Json;
          faqs?: Json;
          review_placeholders?: Json;
          pricing_strategy?: Json;
          upsells?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_product_id?: string;
          title?: string;
          description?: string;
          benefits?: Json;
          faqs?: Json;
          review_placeholders?: Json;
          pricing_strategy?: Json;
          upsells?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_content_store_product_id_fkey";
            columns: ["store_product_id"];
            referencedRelation: "store_products";
            referencedColumns: ["id"];
          },
        ];
      };
      seo_content: {
        Row: {
          id: string;
          store_product_id: string;
          seo_title: string;
          meta_description: string;
          keywords: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_product_id: string;
          seo_title: string;
          meta_description: string;
          keywords?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_product_id?: string;
          seo_title?: string;
          meta_description?: string;
          keywords?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seo_content_store_product_id_fkey";
            columns: ["store_product_id"];
            referencedRelation: "store_products";
            referencedColumns: ["id"];
          },
        ];
      };
      marketing_content: {
        Row: {
          id: string;
          store_id: string;
          platform: "tiktok" | "instagram_reels" | "facebook";
          hooks: Json;
          scripts: Json;
          captions: Json;
          banner_copy: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          platform: "tiktok" | "instagram_reels" | "facebook";
          hooks?: Json;
          scripts?: Json;
          captions?: Json;
          banner_copy?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          platform?: "tiktok" | "instagram_reels" | "facebook";
          hooks?: Json;
          scripts?: Json;
          captions?: Json;
          banner_copy?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "marketing_content_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      shopify_connections: {
        Row: {
          id: string;
          store_id: string;
          shop_domain: string;
          access_token: string;
          scopes: Json;
          connected_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          shop_domain: string;
          access_token: string;
          scopes?: Json;
          connected_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          shop_domain?: string;
          access_token?: string;
          scopes?: Json;
          connected_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shopify_connections_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      build_jobs: {
        Row: {
          id: string;
          store_id: string;
          status: "pending" | "running" | "completed" | "failed";
          current_step: string | null;
          steps_completed: Json;
          error: string | null;
          started_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          store_id: string;
          status?: "pending" | "running" | "completed" | "failed";
          current_step?: string | null;
          steps_completed?: Json;
          error?: string | null;
          started_at?: string;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          store_id?: string;
          status?: "pending" | "running" | "completed" | "failed";
          current_step?: string | null;
          steps_completed?: Json;
          error?: string | null;
          started_at?: string;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "build_jobs_store_id_fkey";
            columns: ["store_id"];
            referencedRelation: "stores";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_ledger: {
        Row: {
          id: string;
          owner_id: string;
          amount: number;
          reason: "subscription_grant" | "store_build" | "purchase";
          stripe_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          amount: number;
          reason: "subscription_grant" | "store_build" | "purchase";
          stripe_event_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          amount?: number;
          reason?: "subscription_grant" | "store_build" | "purchase";
          stripe_event_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_ledger_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
