export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProductStatus = "pending" | "active" | "closed";

export type Database = {
  public: {
    Tables: {
      products: {
        Row: {
          id: string;
          title: string;
          description: string;
          category: string;
          created_at: string;
          updated_at: string;
          publish_at: string;
          closes_at: string;
          status: ProductStatus;
          participant_count: number;
          starting_price: number;
          current_price: number;
          bid_increment: number;
          image_urls: string[];
          bid_history: Json;
        };
        Insert: {
          id?: string;
          title: string;
          description: string;
          category?: string;
          created_at?: string;
          updated_at?: string;
          publish_at: string;
          closes_at: string;
          status: ProductStatus;
          participant_count?: number;
          starting_price: number;
          current_price: number;
          bid_increment?: number;
          image_urls: string[];
          bid_history?: Json;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string;
          category?: string;
          created_at?: string;
          updated_at?: string;
          publish_at?: string;
          closes_at?: string;
          status?: ProductStatus;
          participant_count?: number;
          starting_price?: number;
          current_price?: number;
          bid_increment?: number;
          image_urls?: string[];
          bid_history?: Json;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
