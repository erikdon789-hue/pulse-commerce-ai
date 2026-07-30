// Hand-written to match supabase/migrations/0001_init.sql.
// Once you have a live Supabase project, regenerate with:
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
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          stripe_customer_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          description: string | null;
          price_cents: number;
          currency: string;
          image_url: string | null;
          stripe_price_id: string | null;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          description?: string | null;
          price_cents: number;
          currency?: string;
          image_url?: string | null;
          stripe_price_id?: string | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name?: string;
          description?: string | null;
          price_cents?: number;
          currency?: string;
          image_url?: string | null;
          stripe_price_id?: string | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_owner_id_fkey";
            columns: ["owner_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          id: string;
          buyer_id: string;
          stripe_checkout_session_id: string | null;
          status: "pending" | "paid" | "fulfilled" | "canceled";
          total_cents: number;
          currency: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          buyer_id: string;
          stripe_checkout_session_id?: string | null;
          status?: "pending" | "paid" | "fulfilled" | "canceled";
          total_cents: number;
          currency?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          buyer_id?: string;
          stripe_checkout_session_id?: string | null;
          status?: "pending" | "paid" | "fulfilled" | "canceled";
          total_cents?: number;
          currency?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey";
            columns: ["buyer_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          quantity: number;
          unit_price_cents: number;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          quantity: number;
          unit_price_cents: number;
        };
        Update: {
          id?: string;
          order_id?: string;
          product_id?: string;
          quantity?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_products: {
        Args: {
          query_embedding: number[];
          match_count?: number;
        };
        Returns: Database["public"]["Tables"]["products"]["Row"][];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
