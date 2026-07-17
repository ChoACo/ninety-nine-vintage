export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProductStatus = "pending" | "active" | "closed";
export type SupportConversationStatus = "open" | "closed";

export type Database = {
  public: {
    Tables: {
      auction_bids: {
        Row: {
          id: string;
          product_id: string;
          bidder_id: string | null;
          bidder_display_name: string;
          amount: number;
          is_final: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          bidder_id?: string | null;
          bidder_display_name: string;
          amount: number;
          is_final?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          bidder_id?: string | null;
          bidder_display_name?: string;
          amount?: number;
          is_final?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auction_bids_bidder_id_fkey";
            columns: ["bidder_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "auction_bids_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      operator_accounts: {
        Row: {
          username: string;
          display_name: string;
          auth_user_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          username: string;
          display_name: string;
          auth_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          username?: string;
          display_name?: string;
          auth_user_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "operator_accounts_auth_user_id_fkey";
            columns: ["auth_user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
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
          bid_locked_at: string | null;
          final_bid_id: string | null;
          final_bid_amount: number | null;
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
          bid_locked_at?: string | null;
          final_bid_id?: string | null;
          final_bid_amount?: number | null;
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
          bid_locked_at?: string | null;
          final_bid_id?: string | null;
          final_bid_amount?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_final_bid_matches_product_fkey";
            columns: ["final_bid_id", "id"];
            isOneToOne: false;
            referencedRelation: "auction_bids";
            referencedColumns: ["id", "product_id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      support_conversations: {
        Row: {
          id: string;
          member_id: string;
          assigned_staff_id: string | null;
          status: SupportConversationStatus;
          last_message_at: string | null;
          last_message_preview: string | null;
          last_sender_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          assigned_staff_id?: string | null;
          status?: SupportConversationStatus;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          last_sender_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          assigned_staff_id?: string | null;
          status?: SupportConversationStatus;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          last_sender_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_conversations_assigned_staff_id_fkey";
            columns: ["assigned_staff_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_conversations_last_sender_id_fkey";
            columns: ["last_sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_conversations_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string | null;
          body: string;
          client_nonce: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id?: string | null;
          body: string;
          client_nonce?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender_id?: string | null;
          body?: string;
          client_nonce?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "support_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      support_reads: {
        Row: {
          conversation_id: string;
          user_id: string;
          last_read_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string;
        };
        Update: {
          conversation_id?: string;
          user_id?: string;
          last_read_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "support_reads_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "support_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_reads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      can_access_support_conversation: {
        Args: { p_conversation_id: string };
        Returns: boolean;
      };
      get_or_create_support_conversation: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          member_id: string;
          assigned_staff_id: string | null;
          status: SupportConversationStatus;
          last_message_at: string | null;
          last_message_preview: string | null;
          last_sender_id: string | null;
          created_at: string;
          updated_at: string;
        }[];
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_member: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      is_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      mark_support_conversation_read: {
        Args: { p_conversation_id: string };
        Returns: {
          conversation_id: string;
          user_id: string;
          last_read_at: string;
        }[];
      };
      place_bid: {
        Args: {
          p_product_id: string;
          p_amount: number;
        };
        Returns: {
          bid_id: string;
          product_id: string;
          bidder_id: string;
          bidder_display_name: string;
          amount: number;
          created_at: string;
          is_final: boolean;
          current_price: number;
          participant_count: number;
          bid_locked_at: string | null;
          final_bid_id: string | null;
        }[];
      };
      reopen_my_support_conversation: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          member_id: string;
          assigned_staff_id: string | null;
          status: SupportConversationStatus;
          last_message_at: string | null;
          last_message_preview: string | null;
          last_sender_id: string | null;
          created_at: string;
          updated_at: string;
        }[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
