export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProductStatus = "pending" | "active" | "closed";
export type SupportConversationStatus = "open" | "closed";
export type MemberAccountStatus = "active" | "suspended";
export type ShippingRequestStatus = "requested" | "shipped";
export type PortOnePayMethod = "CARD" | "EASY_PAY" | "VIRTUAL_ACCOUNT";
export type ProductPaymentStatus = "대기중" | "가상계좌발급" | "결제완료";
export type PortOnePaymentStatus =
  | "READY"
  | "PAY_PENDING"
  | "VIRTUAL_ACCOUNT_ISSUED"
  | "PAID"
  | "FAILED"
  | "PARTIAL_CANCELLED"
  | "CANCELLED";

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
      member_accounts: {
        Row: {
          member_id: string;
          phone: string | null;
          shipping_credit_count: number;
          account_status: MemberAccountStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          member_id: string;
          phone?: string | null;
          shipping_credit_count?: number;
          account_status?: MemberAccountStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          member_id?: string;
          phone?: string | null;
          shipping_credit_count?: number;
          account_status?: MemberAccountStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_accounts_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kakao_member_profiles: {
        Row: {
          member_id: string;
          kakao_subject: string;
          full_name: string | null;
          gender: "female" | "male" | null;
          birth_year: number | null;
          profile_complete: boolean;
          consent_items: string[];
          last_synced_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          member_id: string;
          kakao_subject: string;
          full_name?: string | null;
          gender?: "female" | "male" | null;
          birth_year?: number | null;
          profile_complete?: boolean;
          consent_items?: string[];
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          member_id?: string;
          kakao_subject?: string;
          full_name?: string | null;
          gender?: "female" | "male" | null;
          birth_year?: number | null;
          profile_complete?: boolean;
          consent_items?: string[];
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kakao_member_profiles_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kakao_profile_requirements: {
        Row: {
          singleton: boolean;
          enforce_verified_profile: boolean;
          updated_at: string;
        };
        Insert: {
          singleton?: boolean;
          enforce_verified_profile?: boolean;
          updated_at?: string;
        };
        Update: {
          singleton?: boolean;
          enforce_verified_profile?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      payment_attempts: {
        Row: {
          payment_id: string;
          order_id: string;
          requested_method: PortOnePayMethod;
          store_id: string;
          expected_amount: number;
          currency: string;
          payment_method: string | null;
          vbank_num: string | null;
          vbank_bank: string | null;
          vbank_due: string | null;
          payment_status: ProductPaymentStatus;
          portone_status: PortOnePaymentStatus | null;
          portone_status_changed_at: string | null;
          paid_at: string | null;
          verified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          payment_id: string;
          order_id: string;
          requested_method: PortOnePayMethod;
          store_id: string;
          expected_amount: number;
          currency?: string;
          payment_method?: string | null;
          vbank_num?: string | null;
          vbank_bank?: string | null;
          vbank_due?: string | null;
          payment_status?: ProductPaymentStatus;
          portone_status?: PortOnePaymentStatus | null;
          portone_status_changed_at?: string | null;
          paid_at?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          payment_id?: string;
          order_id?: string;
          requested_method?: PortOnePayMethod;
          store_id?: string;
          expected_amount?: number;
          currency?: string;
          payment_method?: string | null;
          vbank_num?: string | null;
          vbank_bank?: string | null;
          vbank_due?: string | null;
          payment_status?: ProductPaymentStatus;
          portone_status?: PortOnePaymentStatus | null;
          portone_status_changed_at?: string | null;
          paid_at?: string | null;
          verified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "payment_orders";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_orders: {
        Row: {
          id: string;
          product_id: string;
          buyer_id: string | null;
          buyer_deleted_at: string | null;
          order_name: string;
          expected_amount: number;
          currency: string;
          payment_id: string;
          requested_method: PortOnePayMethod;
          store_id: string;
          payment_method: string | null;
          vbank_num: string | null;
          vbank_bank: string | null;
          vbank_due: string | null;
          payment_status: ProductPaymentStatus;
          portone_status: PortOnePaymentStatus | null;
          portone_status_changed_at: string | null;
          paid_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          buyer_id?: string | null;
          buyer_deleted_at?: string | null;
          order_name: string;
          expected_amount: number;
          currency?: string;
          payment_id: string;
          requested_method: PortOnePayMethod;
          store_id: string;
          payment_method?: string | null;
          vbank_num?: string | null;
          vbank_bank?: string | null;
          vbank_due?: string | null;
          payment_status?: ProductPaymentStatus;
          portone_status?: PortOnePaymentStatus | null;
          portone_status_changed_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          buyer_id?: string | null;
          buyer_deleted_at?: string | null;
          order_name?: string;
          expected_amount?: number;
          currency?: string;
          payment_id?: string;
          requested_method?: PortOnePayMethod;
          store_id?: string;
          payment_method?: string | null;
          vbank_num?: string | null;
          vbank_bank?: string | null;
          vbank_due?: string | null;
          payment_status?: ProductPaymentStatus;
          portone_status?: PortOnePaymentStatus | null;
          portone_status_changed_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_orders_buyer_id_fkey";
            columns: ["buyer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payment_orders_current_attempt_fkey";
            columns: ["payment_id", "id"];
            isOneToOne: false;
            referencedRelation: "payment_attempts";
            referencedColumns: ["payment_id", "order_id"];
          },
          {
            foreignKeyName: "payment_orders_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
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
          thumbnail_urls: string[];
          bid_history: Json;
          bid_locked_at: string | null;
          final_bid_id: string | null;
          final_bid_amount: number | null;
          created_by: string | null;
          updated_by: string | null;
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
          thumbnail_urls?: string[];
          bid_history?: Json;
          bid_locked_at?: string | null;
          final_bid_id?: string | null;
          final_bid_amount?: number | null;
          created_by?: string | null;
          updated_by?: string | null;
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
          thumbnail_urls?: string[];
          bid_history?: Json;
          bid_locked_at?: string | null;
          final_bid_id?: string | null;
          final_bid_amount?: number | null;
          created_by?: string | null;
          updated_by?: string | null;
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
      shipping_addresses: {
        Row: {
          id: string;
          member_id: string;
          label: string;
          recipient_name: string;
          phone: string;
          address: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          label: string;
          recipient_name: string;
          phone: string;
          address: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          label?: string;
          recipient_name?: string;
          phone?: string;
          address?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_addresses_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shipping_request_items: {
        Row: {
          request_id: string;
          product_id: string;
          created_at: string;
        };
        Insert: {
          request_id: string;
          product_id: string;
          created_at?: string;
        };
        Update: {
          request_id?: string;
          product_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_request_items_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "shipping_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shipping_request_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: true;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      shipping_requests: {
        Row: {
          id: string;
          member_id: string | null;
          member_deleted_at: string | null;
          address_id: string | null;
          address_snapshot: Json;
          status: ShippingRequestStatus;
          courier: string | null;
          tracking_number: string | null;
          requested_at: string;
          shipped_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_id?: string | null;
          member_deleted_at?: string | null;
          address_id?: string | null;
          address_snapshot: Json;
          status?: ShippingRequestStatus;
          courier?: string | null;
          tracking_number?: string | null;
          requested_at?: string;
          shipped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string | null;
          member_deleted_at?: string | null;
          address_id?: string | null;
          address_snapshot?: Json;
          status?: ShippingRequestStatus;
          courier?: string | null;
          tracking_number?: string | null;
          requested_at?: string;
          shipped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shipping_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shipping_requests_address_id_fkey";
            columns: ["address_id"];
            isOneToOne: false;
            referencedRelation: "shipping_addresses";
            referencedColumns: ["id"];
          },
        ];
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
      adjust_member_shipping_credits: {
        Args: { p_member_id: string; p_delta: number };
        Returns: number;
      };
      delete_managed_product: {
        Args: { p_product_id: string; p_expected_updated_at: string };
        Returns: string[];
      };
      delete_my_shipping_address: {
        Args: { p_address_id: string };
        Returns: undefined;
      };
      get_my_won_products: {
        Args: Record<PropertyKey, never>;
        Returns: {
          product_id: string;
          title: string;
          image_urls: string[];
          closed_at: string;
          final_bid_amount: number;
          shipping_status: "ready" | "requested" | "shipped";
          shipment_request_id: string | null;
          payment_id: string | null;
          payment_method: string | null;
          vbank_num: string | null;
          vbank_bank: string | null;
          vbank_due: string | null;
          payment_status: ProductPaymentStatus;
          requested_method: PortOnePayMethod | null;
          portone_status: PortOnePaymentStatus | null;
        }[];
      };
      get_online_member_directory: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          display_name: string;
        }[];
      };
      get_staff_member_directory: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          id: string;
          display_name: string;
          legal_name: string | null;
          email: string | null;
          phone: string | null;
          gender: "female" | "male" | null;
          birth_year: number | null;
          kakao_profile_complete: boolean;
          kakao_synced_at: string | null;
          account_status: MemberAccountStatus;
          shipping_credit_count: number;
          address_count: number;
          bid_count: number;
          support_status: SupportConversationStatus | null;
          created_at: string;
          last_sign_in_at: string | null;
        }[];
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      has_required_kakao_profile: {
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
      prepare_portone_payment: {
        Args: {
          p_member_id: string;
          p_product_id: string;
          p_payment_id: string;
          p_requested_method: PortOnePayMethod;
          p_store_id: string;
        };
        Returns: {
          payment_id: string;
          product_id: string;
          order_name: string;
          expected_amount: number;
          payment_status: ProductPaymentStatus;
        }[];
      };
      publish_pending_products_now: {
        Args: { p_product_ids: string[] };
        Returns: {
          requested_count: number;
          published_count: number;
          skipped_count: number;
          published_ids: string[];
          skipped_ids: string[];
          published_at: string;
          closes_at: string;
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
      request_product_shipping: {
        Args: { p_product_ids: string[]; p_address_id: string };
        Returns: string;
      };
      set_member_account_status: {
        Args: { p_member_id: string; p_status: MemberAccountStatus };
        Returns: MemberAccountStatus;
      };
      sync_portone_payment: {
        Args: {
          p_payment_id: string;
          p_portone_status: PortOnePaymentStatus;
          p_store_id: string;
          p_amount: number;
          p_currency: string;
          p_payment_method: string | null;
          p_vbank_num: string | null;
          p_vbank_bank: string | null;
          p_vbank_due: string | null;
          p_status_changed_at: string;
          p_paid_at: string | null;
        };
        Returns: {
          payment_status: ProductPaymentStatus;
          portone_status: PortOnePaymentStatus | null;
        }[];
      };
      touch_my_last_seen: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      update_managed_product: {
        Args: {
          p_product_id: string;
          p_title: string;
          p_description: string;
          p_starting_price: number;
          p_bid_increment: number;
          p_status: ProductStatus;
          p_publish_at: string;
          p_expected_updated_at: string;
        };
        Returns: Database["public"]["Tables"]["products"]["Row"][];
      };
      upsert_my_shipping_address: {
        Args: {
          p_id: string | null;
          p_label: string;
          p_recipient_name: string;
          p_phone: string;
          p_address: string;
          p_is_default?: boolean;
        };
        Returns: Database["public"]["Tables"]["shipping_addresses"]["Row"][];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
