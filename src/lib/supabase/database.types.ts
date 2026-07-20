export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ProductStatus = "pending" | "active" | "closed"
export type ProductSaleType = "auction" | "fixed"
export type SupportConversationStatus = "open" | "closed"
export type MemberAccountStatus = "active" | "suspended"
export type ShippingRequestStatus = "requested" | "shipped"
export type PortOnePayMethod = "CARD" | "EASY_PAY" | "VIRTUAL_ACCOUNT"
export type ProductPaymentStatus = "대기중" | "가상계좌발급" | "결제완료"
export type ActivePaymentMode = "manual_transfer" | "portone"
export type ManualTransferStatus =
  | "awaiting_manual_transfer"
  | "confirmed"
  | "cancelled_unpaid"
export type AuctionPurchaseOfferKind = "original" | "second_chance"
export type AuctionPurchaseOfferStatus =
  | "payment_due"
  | "offered"
  | "accepted"
  | "settled"
  | "expired_unpaid"
  | "declined"
  | "expired_offer"
  | "no_successor"
export type PortOnePaymentStatus =
  | "READY"
  | "PAY_PENDING"
  | "VIRTUAL_ACCOUNT_ISSUED"
  | "PAID"
  | "FAILED"
  | "PARTIAL_CANCELLED"
  | "CANCELLED"

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      site_status: {
        Row: {
          singleton: boolean
          status: string
          message: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          singleton?: boolean
          status?: string
          message?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          singleton?: boolean
          status?: string
          message?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      account_access_roles: {
        Row: {
          created_at: string
          grade_level: number | null
          reports_to_operator_id: string | null
          role_code: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          grade_level?: number | null
          reports_to_operator_id?: string | null
          role_code: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          grade_level?: number | null
          reports_to_operator_id?: string | null
          role_code?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_access_roles_reports_to_operator_id_fkey"
            columns: ["reports_to_operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_access_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_last_seen: {
        Row: {
          last_seen_at: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_last_seen_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_bids: {
        Row: {
          amount: number
          bidder_display_name: string
          bidder_id: string | null
          created_at: string
          id: string
          is_final: boolean
          product_id: string
        }
        Insert: {
          amount: number
          bidder_display_name: string
          bidder_id?: string | null
          created_at?: string
          id?: string
          is_final?: boolean
          product_id: string
        }
        Update: {
          amount?: number
          bidder_display_name?: string
          bidder_id?: string | null
          created_at?: string
          id?: string
          is_final?: boolean
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_bids_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_offer_penalties: {
        Row: {
          created_at: string
          offer_id: string
          warning_id: string
        }
        Insert: {
          created_at?: string
          offer_id: string
          warning_id: string
        }
        Update: {
          created_at?: string
          offer_id?: string
          warning_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_offer_penalties_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: true
            referencedRelation: "auction_purchase_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_offer_penalties_warning_id_fkey"
            columns: ["warning_id"]
            isOneToOne: true
            referencedRelation: "member_warnings"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_purchase_offers: {
        Row: {
          accepted_at: string | null
          bid_id: string | null
          bidder_display_name_snapshot: string
          bidder_id: string | null
          id: string
          offer_kind: string
          offer_round: number
          offered_amount: number
          offered_at: string
          payment_due_at: string | null
          previous_offer_id: string | null
          product_id: string
          response_due_at: string | null
          settled_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          bid_id?: string | null
          bidder_display_name_snapshot: string
          bidder_id?: string | null
          id?: string
          offer_kind: string
          offer_round: number
          offered_amount: number
          offered_at?: string
          payment_due_at?: string | null
          previous_offer_id?: string | null
          product_id: string
          response_due_at?: string | null
          settled_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          bid_id?: string | null
          bidder_display_name_snapshot?: string
          bidder_id?: string | null
          id?: string
          offer_kind?: string
          offer_round?: number
          offered_amount?: number
          offered_at?: string
          payment_due_at?: string | null
          previous_offer_id?: string | null
          product_id?: string
          response_due_at?: string | null
          settled_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_purchase_offers_bid_id_fkey"
            columns: ["bid_id"]
            isOneToOne: false
            referencedRelation: "auction_bids"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_purchase_offers_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_purchase_offers_previous_offer_id_fkey"
            columns: ["previous_offer_id"]
            isOneToOne: false
            referencedRelation: "auction_purchase_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_purchase_offers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_revenue_defense_settings: {
        Row: {
          created_at: string
          original_payment_hour: number
          original_payment_minute: number
          policy_effective_at: string
          second_chance_hours: number
          singleton: boolean
        }
        Insert: {
          created_at?: string
          original_payment_hour?: number
          original_payment_minute?: number
          policy_effective_at?: string
          second_chance_hours?: number
          singleton?: boolean
        }
        Update: {
          created_at?: string
          original_payment_hour?: number
          original_payment_minute?: number
          policy_effective_at?: string
          second_chance_hours?: number
          singleton?: boolean
        }
        Relationships: []
      }
      cancelled_auction_bids: {
        Row: {
          amount: number
          bidder_display_name: string
          bidder_id: string | null
          cancellation_reason: string
          cancelled_at: string
          original_bid_id: string
          original_created_at: string
          product_id: string
          sanction_id: string | null
          was_final: boolean
        }
        Insert: {
          amount: number
          bidder_display_name: string
          bidder_id?: string | null
          cancellation_reason?: string
          cancelled_at?: string
          original_bid_id: string
          original_created_at: string
          product_id: string
          sanction_id?: string | null
          was_final: boolean
        }
        Update: {
          amount?: number
          bidder_display_name?: string
          bidder_id?: string | null
          cancellation_reason?: string
          cancelled_at?: string
          original_bid_id?: string
          original_created_at?: string
          product_id?: string
          sanction_id?: string | null
          was_final?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "cancelled_auction_bids_bidder_id_fkey"
            columns: ["bidder_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelled_auction_bids_sanction_id_fkey"
            columns: ["sanction_id"]
            isOneToOne: false
            referencedRelation: "member_bid_sanctions"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          created_at: string
          member_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          paid_at: string | null
          payment_status: string
          product_id: string
          storage_expires_at: string | null
          store_id: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          paid_at?: string | null
          payment_status?: string
          product_id: string
          storage_expires_at?: string | null
          store_id?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          paid_at?: string | null
          payment_status?: string
          product_id?: string
          storage_expires_at?: string | null
          store_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "commerce_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_order_items_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_order_transfers: {
        Row: {
          account_number_snapshot: string
          bank_name_snapshot: string
          confirmed_at: string | null
          confirmed_by: string | null
          expected_amount: number
          id: string
          member_id: string
          order_id: string
          requested_at: string
          status: string
        }
        Insert: {
          account_number_snapshot: string
          bank_name_snapshot: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          expected_amount: number
          id?: string
          member_id: string
          order_id: string
          requested_at?: string
          status?: string
        }
        Update: {
          account_number_snapshot?: string
          bank_name_snapshot?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
          expected_amount?: number
          id?: string
          member_id?: string
          order_id?: string
          requested_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "commerce_order_transfers_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_order_transfers_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_order_transfers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_orders: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          member_id: string
          shipping_credit_applied: boolean
          shipping_fee: number
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          member_id: string
          shipping_credit_applied?: boolean
          shipping_fee?: number
          status?: string
          subtotal: number
          total: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          member_id?: string
          shipping_credit_applied?: boolean
          shipping_fee?: number
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commerce_orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_revenue: {
        Row: {
          gross_amount: number
          paid_order_count: number
          revenue_date: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          gross_amount: number
          paid_order_count: number
          revenue_date: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          gross_amount?: number
          paid_order_count?: number
          revenue_date?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_revenue_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kakao_member_profiles: {
        Row: {
          birth_year: number | null
          consent_items: string[]
          created_at: string
          full_name: string | null
          gender: string | null
          kakao_subject: string
          last_synced_at: string
          member_id: string
          profile_complete: boolean
          updated_at: string
        }
        Insert: {
          birth_year?: number | null
          consent_items?: string[]
          created_at?: string
          full_name?: string | null
          gender?: string | null
          kakao_subject: string
          last_synced_at?: string
          member_id: string
          profile_complete?: boolean
          updated_at?: string
        }
        Update: {
          birth_year?: number | null
          consent_items?: string[]
          created_at?: string
          full_name?: string | null
          gender?: string | null
          kakao_subject?: string
          last_synced_at?: string
          member_id?: string
          profile_complete?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kakao_member_profiles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kakao_profile_requirements: {
        Row: {
          enforce_verified_profile: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enforce_verified_profile?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enforce_verified_profile?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      manual_transfer_orders: {
        Row: {
          account_number_snapshot: string
          bank_name_snapshot: string
          buyer_deleted_at: string | null
          buyer_id: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          currency: string
          due_at: string | null
          expected_amount: number
          id: string
          order_name: string
          product_id: string
          purchase_offer_id: string | null
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          account_number_snapshot: string
          bank_name_snapshot: string
          buyer_deleted_at?: string | null
          buyer_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          due_at?: string | null
          expected_amount: number
          id?: string
          order_name: string
          product_id: string
          purchase_offer_id?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_number_snapshot?: string
          bank_name_snapshot?: string
          buyer_deleted_at?: string | null
          buyer_id?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          currency?: string
          due_at?: string | null
          expected_amount?: number
          id?: string
          order_name?: string
          product_id?: string
          purchase_offer_id?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_transfer_orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_orders_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_orders_purchase_offer_id_fkey"
            columns: ["purchase_offer_id"]
            isOneToOne: false
            referencedRelation: "auction_purchase_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_transfer_payment_ledger: {
        Row: {
          amount: number
          commerce_order_transfer_id: string | null
          created_at: string
          depositor_name: string | null
          entry_type: string
          id: string
          manual_transfer_order_id: string | null
          memo: string
          recorded_by: string
          reversal_of: string | null
          shipping_fee_payment_id: string | null
          transfer_kind: string
        }
        Insert: {
          amount: number
          commerce_order_transfer_id?: string | null
          created_at?: string
          depositor_name?: string | null
          entry_type: string
          id?: string
          manual_transfer_order_id?: string | null
          memo?: string
          recorded_by: string
          reversal_of?: string | null
          shipping_fee_payment_id?: string | null
          transfer_kind: string
        }
        Update: {
          amount?: number
          commerce_order_transfer_id?: string | null
          created_at?: string
          depositor_name?: string | null
          entry_type?: string
          id?: string
          manual_transfer_order_id?: string | null
          memo?: string
          recorded_by?: string
          reversal_of?: string | null
          shipping_fee_payment_id?: string | null
          transfer_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_transfer_payment_ledger_commerce_order_transfer_id_fkey"
            columns: ["commerce_order_transfer_id"]
            isOneToOne: false
            referencedRelation: "commerce_order_transfers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_payment_ledger_manual_transfer_order_id_fkey"
            columns: ["manual_transfer_order_id"]
            isOneToOne: false
            referencedRelation: "manual_transfer_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_transfer_payment_ledger_shipping_fee_payment_id_fkey"
            columns: ["shipping_fee_payment_id"]
            isOneToOne: false
            referencedRelation: "shipping_fee_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      member_accounts: {
        Row: {
          account_status: string
          created_at: string
          member_id: string
          phone: string | null
          shipping_credit_count: number
          updated_at: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          member_id: string
          phone?: string | null
          shipping_credit_count?: number
          updated_at?: string
        }
        Update: {
          account_status?: string
          created_at?: string
          member_id?: string
          phone?: string | null
          shipping_credit_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_accounts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_bid_sanctions: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          member_id: string
          sanction_round: number
          starts_at: string
          warning_id: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          member_id: string
          sanction_round: number
          starts_at: string
          warning_id: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          member_id?: string
          sanction_round?: number
          starts_at?: string
          warning_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_bid_sanctions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_bid_sanctions_warning_id_fkey"
            columns: ["warning_id"]
            isOneToOne: true
            referencedRelation: "member_warnings"
            referencedColumns: ["id"]
          },
        ]
      }
      member_warnings: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          reason: string
          warning_number: number
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          reason: string
          warning_number: number
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          reason?: string
          warning_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "member_warnings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_warnings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      nickname_change_requests: {
        Row: {
          created_at: string
          id: string
          member_id: string
          requested_nickname: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          requested_nickname: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          requested_nickname?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "nickname_change_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nickname_change_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience_role: string
          body: string
          created_at: string
          href: string | null
          id: string
          kind: string
          member_id: string | null
          read_at: string | null
          title: string
        }
        Insert: {
          audience_role?: string
          body: string
          created_at?: string
          href?: string | null
          id?: string
          kind: string
          member_id?: string | null
          read_at?: string | null
          title: string
        }
        Update: {
          audience_role?: string
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          member_id?: string | null
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_accounts: {
        Row: {
          auth_user_id: string | null
          created_at: string
          display_name: string
          updated_at: string
          username: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          display_name: string
          updated_at?: string
          username: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          display_name?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_accounts_auth_user_id_fkey"
            columns: ["auth_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_auction_action_audit: {
        Row: {
          action: string
          actor_owner_id: string
          after_state: Json
          before_state: Json
          id: string
          occurred_at: string
          payload: Json
          product_id: string
          reason: string
          subject_member_id: string | null
        }
        Insert: {
          action: string
          actor_owner_id: string
          after_state: Json
          before_state: Json
          id?: string
          occurred_at?: string
          payload?: Json
          product_id: string
          reason: string
          subject_member_id?: string | null
        }
        Update: {
          action?: string
          actor_owner_id?: string
          after_state?: Json
          before_state?: Json
          id?: string
          occurred_at?: string
          payload?: Json
          product_id?: string
          reason?: string
          subject_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_auction_action_audit_actor_owner_id_fkey"
            columns: ["actor_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_auction_action_audit_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_auction_action_audit_subject_member_id_fkey"
            columns: ["subject_member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_hidden_test_member_audit: {
        Row: {
          action: string
          actor_owner_id: string
          id: number
          occurred_at: string
          payload: Json
          target_test_user_id: string
        }
        Insert: {
          action: string
          actor_owner_id: string
          id?: never
          occurred_at?: string
          payload?: Json
          target_test_user_id: string
        }
        Update: {
          action?: string
          actor_owner_id?: string
          id?: never
          occurred_at?: string
          payload?: Json
          target_test_user_id?: string
        }
        Relationships: []
      }
      owner_hidden_test_members: {
        Row: {
          created_at: string
          label: string
          owner_id: string
          retired_at: string | null
          test_user_id: string
        }
        Insert: {
          created_at?: string
          label: string
          owner_id: string
          retired_at?: string | null
          test_user_id: string
        }
        Update: {
          created_at?: string
          label?: string
          owner_id?: string
          retired_at?: string | null
          test_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_hidden_test_members_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_hidden_test_members_test_user_id_fkey"
            columns: ["test_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_operator_delegation_audit: {
        Row: {
          action: string
          actor_owner_id: string
          id: number
          occurred_at: string
          payload: Json
          session_id: string
          target_operator_id: string
        }
        Insert: {
          action: string
          actor_owner_id: string
          id?: never
          occurred_at?: string
          payload?: Json
          session_id: string
          target_operator_id: string
        }
        Update: {
          action?: string
          actor_owner_id?: string
          id?: never
          occurred_at?: string
          payload?: Json
          session_id?: string
          target_operator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_operator_delegation_audit_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "owner_operator_delegation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_operator_delegation_sessions: {
        Row: {
          actor_owner_id: string
          created_at: string
          ended_at: string | null
          expires_at: string
          id: string
          last_used_at: string
          reason: string
          target_operator_id: string
        }
        Insert: {
          actor_owner_id: string
          created_at?: string
          ended_at?: string | null
          expires_at: string
          id?: string
          last_used_at?: string
          reason: string
          target_operator_id: string
        }
        Update: {
          actor_owner_id?: string
          created_at?: string
          ended_at?: string | null
          expires_at?: string
          id?: string
          last_used_at?: string
          reason?: string
          target_operator_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_operator_delegation_ses_actor_owner_id_target_operat_fkey"
            columns: ["actor_owner_id", "target_operator_id"]
            isOneToOne: false
            referencedRelation: "owner_operator_delegation_targets"
            referencedColumns: ["owner_id", "operator_id"]
          },
          {
            foreignKeyName: "owner_operator_delegation_sessions_actor_owner_id_fkey"
            columns: ["actor_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_operator_delegation_sessions_target_operator_id_fkey"
            columns: ["target_operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_operator_delegation_targets: {
        Row: {
          created_at: string
          operator_id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          operator_id: string
          owner_id: string
        }
        Update: {
          created_at?: string
          operator_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_operator_delegation_targets_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_operator_delegation_targets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_attempts: {
        Row: {
          created_at: string
          currency: string
          expected_amount: number
          order_id: string
          paid_at: string | null
          payment_id: string
          payment_method: string | null
          payment_status: string
          portone_status: string | null
          portone_status_changed_at: string | null
          requested_method: string
          store_id: string
          updated_at: string
          vbank_bank: string | null
          vbank_due: string | null
          vbank_num: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          expected_amount: number
          order_id: string
          paid_at?: string | null
          payment_id: string
          payment_method?: string | null
          payment_status?: string
          portone_status?: string | null
          portone_status_changed_at?: string | null
          requested_method: string
          store_id: string
          updated_at?: string
          vbank_bank?: string | null
          vbank_due?: string | null
          vbank_num?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          expected_amount?: number
          order_id?: string
          paid_at?: string | null
          payment_id?: string
          payment_method?: string | null
          payment_status?: string
          portone_status?: string | null
          portone_status_changed_at?: string | null
          requested_method?: string
          store_id?: string
          updated_at?: string
          vbank_bank?: string | null
          vbank_due?: string | null
          vbank_num?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_attempts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_orders: {
        Row: {
          buyer_deleted_at: string | null
          buyer_id: string | null
          created_at: string
          currency: string
          expected_amount: number
          id: string
          order_name: string
          paid_at: string | null
          payment_id: string
          payment_method: string | null
          payment_status: string
          portone_status: string | null
          portone_status_changed_at: string | null
          product_id: string
          requested_method: string
          store_id: string
          updated_at: string
          vbank_bank: string | null
          vbank_due: string | null
          vbank_num: string | null
        }
        Insert: {
          buyer_deleted_at?: string | null
          buyer_id?: string | null
          created_at?: string
          currency?: string
          expected_amount: number
          id?: string
          order_name: string
          paid_at?: string | null
          payment_id: string
          payment_method?: string | null
          payment_status?: string
          portone_status?: string | null
          portone_status_changed_at?: string | null
          product_id: string
          requested_method: string
          store_id: string
          updated_at?: string
          vbank_bank?: string | null
          vbank_due?: string | null
          vbank_num?: string | null
        }
        Update: {
          buyer_deleted_at?: string | null
          buyer_id?: string | null
          created_at?: string
          currency?: string
          expected_amount?: number
          id?: string
          order_name?: string
          paid_at?: string | null
          payment_id?: string
          payment_method?: string | null
          payment_status?: string
          portone_status?: string | null
          portone_status_changed_at?: string | null
          product_id?: string
          requested_method?: string
          store_id?: string
          updated_at?: string
          vbank_bank?: string | null
          vbank_due?: string | null
          vbank_num?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_orders_current_attempt_fkey"
            columns: ["payment_id", "id"]
            isOneToOne: false
            referencedRelation: "payment_attempts"
            referencedColumns: ["payment_id", "order_id"]
          },
          {
            foreignKeyName: "payment_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_runtime_settings: {
        Row: {
          account_number: string | null
          active_mode: string
          bank_name: string | null
          singleton: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_number?: string | null
          active_mode?: string
          bank_name?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_number?: string | null
          active_mode?: string
          bank_name?: string | null
          singleton?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_runtime_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          anti_sniping_base_closes_at: string | null
          anti_sniping_extended_at: string | null
          anti_sniping_extension_count: number
          auction_feed_expires_at: string | null
          bid_history: Json
          bid_increment: number
          bid_locked_at: string | null
          category: string
          closes_at: string
          condition_grade: string
          created_at: string
          created_by: string | null
          current_price: number
          description: string
          final_bid_amount: number | null
          final_bid_id: string | null
          fixed_price: number | null
          id: string
          image_urls: string[]
          inquiry_operator_id: string | null
          inspection_notes: string[]
          measurements: Json
          participant_count: number
          past_action: string | null
          past_at: string | null
          past_expires_at: string | null
          publish_at: string
          sale_type: string
          size_label: string
          starting_price: number
          status: string
          storage_class: string
          store_id: string | null
          thumbnail_urls: string[]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anti_sniping_base_closes_at?: string | null
          anti_sniping_extended_at?: string | null
          anti_sniping_extension_count?: number
          auction_feed_expires_at?: string | null
          bid_history?: Json
          bid_increment?: number
          bid_locked_at?: string | null
          category?: string
          closes_at: string
          condition_grade?: string
          created_at?: string
          created_by?: string | null
          current_price: number
          description: string
          final_bid_amount?: number | null
          final_bid_id?: string | null
          fixed_price?: number | null
          id?: string
          image_urls: string[]
          inquiry_operator_id?: string | null
          inspection_notes?: string[]
          measurements?: Json
          participant_count?: number
          past_action?: string | null
          past_at?: string | null
          past_expires_at?: string | null
          publish_at: string
          sale_type?: string
          size_label?: string
          starting_price: number
          status: string
          storage_class?: string
          store_id?: string | null
          thumbnail_urls?: string[]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anti_sniping_base_closes_at?: string | null
          anti_sniping_extended_at?: string | null
          anti_sniping_extension_count?: number
          auction_feed_expires_at?: string | null
          bid_history?: Json
          bid_increment?: number
          bid_locked_at?: string | null
          category?: string
          closes_at?: string
          condition_grade?: string
          created_at?: string
          created_by?: string | null
          current_price?: number
          description?: string
          final_bid_amount?: number | null
          final_bid_id?: string | null
          fixed_price?: number | null
          id?: string
          image_urls?: string[]
          inquiry_operator_id?: string | null
          inspection_notes?: string[]
          measurements?: Json
          participant_count?: number
          past_action?: string | null
          past_at?: string | null
          past_expires_at?: string | null
          publish_at?: string
          sale_type?: string
          size_label?: string
          starting_price?: number
          status?: string
          storage_class?: string
          store_id?: string | null
          thumbnail_urls?: string[]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_final_bid_matches_product_fkey"
            columns: ["final_bid_id", "id"]
            isOneToOne: false
            referencedRelation: "auction_bids"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "products_inquiry_operator_id_fkey"
            columns: ["inquiry_operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          nickname_initialized_at: string | null
          nickname_self_change_used_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          nickname_initialized_at?: string | null
          nickname_self_change_used_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          nickname_initialized_at?: string | null
          nickname_self_change_used_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      security_activity_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          category: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: number
          ip_address: unknown
          metadata: Json
          occurred_at: string
          severity: string
          source: string
          subject_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          category: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: never
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          severity?: string
          source: string
          subject_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          category?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: never
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          severity?: string
          source?: string
          subject_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      security_ip_block_rule_audit: {
        Row: {
          action: string
          actor_user_id: string
          after_state: Json
          before_state: Json
          change_reason: string
          id: number
          occurred_at: string
          rule_id: string
        }
        Insert: {
          action: string
          actor_user_id: string
          after_state?: Json
          before_state?: Json
          change_reason: string
          id?: never
          occurred_at?: string
          rule_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          after_state?: Json
          before_state?: Json
          change_reason?: string
          id?: never
          occurred_at?: string
          rule_id?: string
        }
        Relationships: []
      }
      security_ip_block_rules: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          enabled: boolean
          expires_at: string | null
          id: string
          label: string | null
          network: unknown
          reason: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          label?: string | null
          network: unknown
          reason: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          label?: string | null
          network?: unknown
          reason?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: []
      }
      security_log_access_decisions: {
        Row: {
          access_expires_at: string | null
          actor_user_id: string
          decided_at: string
          decision_type: string
          id: number
          note: string | null
          request_id: string
        }
        Insert: {
          access_expires_at?: string | null
          actor_user_id: string
          decided_at?: string
          decision_type: string
          id?: never
          note?: string | null
          request_id: string
        }
        Update: {
          access_expires_at?: string | null
          actor_user_id?: string
          decided_at?: string
          decision_type?: string
          id?: never
          note?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_log_access_decisions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "security_log_access_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      security_log_access_requests: {
        Row: {
          created_at: string
          id: string
          reason: string
          request_expires_at: string
          requested_from: string
          requested_to: string
          requester_user_id: string
          subject_user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason: string
          request_expires_at?: string
          requested_from: string
          requested_to: string
          requester_user_id: string
          subject_user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string
          request_expires_at?: string
          requested_from?: string
          requested_to?: string
          requester_user_id?: string
          subject_user_id?: string
        }
        Relationships: []
      }
      security_retention_runs: {
        Row: {
          access_decisions_deleted: number
          access_requests_deleted: number
          activity_logs_deleted: number
          archived_ip_rules_deleted: number
          id: number
          ip_rule_audit_deleted: number
          legacy_delegation_sessions_deleted: number
          legacy_owner_audit_deleted: number
          occurred_at: string
          session_history_deleted: number
          session_records_deleted: number
        }
        Insert: {
          access_decisions_deleted?: number
          access_requests_deleted?: number
          activity_logs_deleted?: number
          archived_ip_rules_deleted?: number
          id?: never
          ip_rule_audit_deleted?: number
          legacy_delegation_sessions_deleted?: number
          legacy_owner_audit_deleted?: number
          occurred_at?: string
          session_history_deleted?: number
          session_records_deleted?: number
        }
        Update: {
          access_decisions_deleted?: number
          access_requests_deleted?: number
          activity_logs_deleted?: number
          archived_ip_rules_deleted?: number
          id?: never
          ip_rule_audit_deleted?: number
          legacy_delegation_sessions_deleted?: number
          legacy_owner_audit_deleted?: number
          occurred_at?: string
          session_history_deleted?: number
          session_records_deleted?: number
        }
        Relationships: []
      }
      security_session_ip_history: {
        Row: {
          event_type: string
          id: number
          ip_address: unknown
          matched_rule_id: string | null
          observed_at: string
          outcome: string
          session_record_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          event_type: string
          id?: never
          ip_address: unknown
          matched_rule_id?: string | null
          observed_at?: string
          outcome: string
          session_record_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          event_type?: string
          id?: never
          ip_address?: unknown
          matched_rule_id?: string | null
          observed_at?: string
          outcome?: string
          session_record_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_session_ip_history_matched_rule_id_fkey"
            columns: ["matched_rule_id"]
            isOneToOne: false
            referencedRelation: "security_ip_block_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_session_ip_history_session_record_id_fkey"
            columns: ["session_record_id"]
            isOneToOne: false
            referencedRelation: "security_session_records"
            referencedColumns: ["id"]
          },
        ]
      }
      security_session_records: {
        Row: {
          auth_session_id: string | null
          browser_tab_session_id: string
          first_seen_at: string
          id: string
          last_event: string
          last_outcome: string
          last_seen_at: string
          latest_ip: unknown
          latest_user_agent: string | null
          matched_rule_id: string | null
          user_id: string
        }
        Insert: {
          auth_session_id?: string | null
          browser_tab_session_id: string
          first_seen_at?: string
          id?: string
          last_event: string
          last_outcome: string
          last_seen_at?: string
          latest_ip: unknown
          latest_user_agent?: string | null
          matched_rule_id?: string | null
          user_id: string
        }
        Update: {
          auth_session_id?: string | null
          browser_tab_session_id?: string
          first_seen_at?: string
          id?: string
          last_event?: string
          last_outcome?: string
          last_seen_at?: string
          latest_ip?: unknown
          latest_user_agent?: string | null
          matched_rule_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_session_records_matched_rule_id_fkey"
            columns: ["matched_rule_id"]
            isOneToOne: false
            referencedRelation: "security_ip_block_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_addresses: {
        Row: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          member_id: string
          phone: string
          postal_code: string | null
          recipient_name: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          id?: string
          is_default?: boolean
          label: string
          member_id: string
          phone: string
          postal_code?: string | null
          recipient_name: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          id?: string
          is_default?: boolean
          label?: string
          member_id?: string
          phone?: string
          postal_code?: string | null
          recipient_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_addresses_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_credit_ledger: {
        Row: {
          created_at: string
          created_by: string | null
          delta: number
          id: string
          member_id: string
          order_id: string | null
          reason: string
          shipping_request_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          member_id: string
          order_id?: string | null
          reason: string
          shipping_request_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          member_id?: string
          order_id?: string | null
          reason?: string
          shipping_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_credit_ledger_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_credit_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_credit_ledger_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_fee_payments: {
        Row: {
          account_number_snapshot: string | null
          bank_name_snapshot: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          expected_amount: number
          id: string
          idempotency_key: string | null
          member_id: string
          requested_at: string
          shipping_request_id: string | null
          status: string
        }
        Insert: {
          account_number_snapshot?: string | null
          bank_name_snapshot?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          expected_amount: number
          id?: string
          idempotency_key?: string | null
          member_id: string
          requested_at?: string
          shipping_request_id?: string | null
          status?: string
        }
        Update: {
          account_number_snapshot?: string | null
          bank_name_snapshot?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          expected_amount?: number
          id?: string
          idempotency_key?: string | null
          member_id?: string
          requested_at?: string
          shipping_request_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_fee_payments_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_fee_payments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_request_items: {
        Row: {
          created_at: string
          product_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "shipping_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_requests: {
        Row: {
          address_id: string | null
          address_snapshot: Json
          courier: string | null
          created_at: string
          id: string
          idempotency_key: string | null
          member_deleted_at: string | null
          member_id: string | null
          requested_at: string
          shipped_at: string | null
          status: string
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          address_id?: string | null
          address_snapshot: Json
          courier?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          member_deleted_at?: string | null
          member_id?: string | null
          requested_at?: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          address_id?: string | null
          address_snapshot?: Json
          courier?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string | null
          member_deleted_at?: string | null
          member_id?: string | null
          requested_at?: string
          shipped_at?: string | null
          status?: string
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_requests_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "shipping_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_requests_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          created_at: string
          description: string
          id: string
          is_active: boolean
          name: string
          operator_id: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          name: string
          operator_id: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          operator_id?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_conversations: {
        Row: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          assigned_staff_id?: string | null
          conversation_type?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_id?: string | null
          member_id: string
          product_id?: string | null
          product_image_url_snapshot?: string | null
          product_title_snapshot?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          assigned_staff_id?: string | null
          conversation_type?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          last_sender_id?: string | null
          member_id?: string
          product_id?: string | null
          product_image_url_snapshot?: string | null
          product_title_snapshot?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_assigned_staff_id_fkey"
            columns: ["assigned_staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_last_sender_id_fkey"
            columns: ["last_sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          client_nonce: string
          conversation_id: string
          created_at: string
          id: string
          sender_id: string | null
        }
        Insert: {
          body: string
          client_nonce?: string
          conversation_id: string
          created_at?: string
          id?: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          client_nonce?: string
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlist_items: {
        Row: {
          created_at: string
          member_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          member_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          member_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      access_role_for_user: { Args: { p_user_id: string }; Returns: string }
      add_member_warning: {
        Args: { p_category: string; p_member_id: string; p_reason: string }
        Returns: {
          bid_blocked_until: string
          cancelled_bid_count: number
          sanction_count: number
          warning_count: number
        }[]
      }
      adjust_member_shipping_credits: {
        Args: { p_delta: number; p_member_id: string }
        Returns: number
      }
      assert_valid_member_nickname: {
        Args: { p_nickname: string }
        Returns: string
      }
      assign_unrouted_products_to_operator: { Args: never; Returns: number }
      assign_unrouted_support_conversations: { Args: never; Returns: number }
      auction_close_at: { Args: { p_publish_at: string }; Returns: string }
      auth_user_has_kakao_identity: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      begin_manual_transfer: {
        Args: { p_product_id: string }
        Returns: {
          account_number: string
          bank_name: string
          confirmed_at: string
          expected_amount: number
          is_payment_settled: boolean
          order_id: string
          order_name: string
          product_id: string
          requested_at: string
          status: string
          updated_at: string
        }[]
      }
      begin_owner_operator_delegation: {
        Args: { p_reason: string; p_target_operator_id: string }
        Returns: {
          created_at: string
          expires_at: string
          reason: string
          session_id: string
          target_display_name: string
          target_operator_id: string
        }[]
      }
      can_access_support_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_manage_members: { Args: never; Returns: boolean }
      can_manage_products: { Args: never; Returns: boolean }
      can_manage_support_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_send_support_message: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_view_shipping_queue: { Args: never; Returns: boolean }
      cancel_member_active_bids: {
        Args: { p_member_id: string; p_now: string; p_sanction_id: string }
        Returns: number
      }
      change_my_nickname_once: { Args: { p_nickname: string }; Returns: string }
      choose_support_operator: {
        Args: { p_routing_key: string }
        Returns: string
      }
      claim_fixed_price_product: {
        Args: { p_product_id: string }
        Returns: {
          amount: number
          bid_id: string
          buyer_display_name: string
          buyer_id: string
          claimed_at: string
          product_id: string
        }[]
      }
      claim_my_second_chance_offer: {
        Args: { p_offer_id: string }
        Returns: {
          offer_id: string
          payment_due_at: string
          product_id: string
          status: string
        }[]
      }
      confirm_commerce_order_transfer: {
        Args: { p_order_id: string }
        Returns: boolean
      }
      confirm_manual_transfer: {
        Args: { p_expected_updated_at: string; p_order_id: string }
        Returns: {
          confirmed_at: string
          is_payment_settled: boolean
          order_id: string
          product_id: string
          status: string
          updated_at: string
        }[]
      }
      record_manual_transfer_payment: {
        Args: {
          p_amount: number
          p_depositor_name: string
          p_memo?: string
          p_transfer_id: string
          p_transfer_kind: string
        }
        Returns: Json
      }
      record_shipping_fee_payment: {
        Args: {
          p_amount: number
          p_depositor_name: string
          p_memo?: string
          p_payment_id: string
        }
        Returns: Json
      }
      reverse_manual_transfer_payment: {
        Args: { p_ledger_id: string; p_reason: string }
        Returns: Json
      }
      reverse_shipping_fee_payment: {
        Args: { p_ledger_id: string; p_reason: string }
        Returns: Json
      }
      count_shipping_work: {
        Args: { p_include_shipped?: boolean }
        Returns: number
      }
      create_commerce_order: {
        Args: {
          p_apply_shipping_credit?: boolean
          p_idempotency_key: string
          p_product_ids: string[]
        }
        Returns: Json
      }
      create_commerce_order_transfer: {
        Args: { p_order_id: string }
        Returns: Json
      }
      current_access_role: { Args: never; Returns: string }
      current_owner_delegated_operator: { Args: never; Returns: string }
      decline_my_second_chance_offer: {
        Args: { p_offer_id: string }
        Returns: string
      }
      delete_managed_member: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      delete_managed_product: {
        Args: { p_expected_updated_at: string; p_product_id: string }
        Returns: string[]
      }
      delete_my_shipping_address: {
        Args: { p_address_id: string }
        Returns: undefined
      }
      end_owner_operator_delegation: {
        Args: { p_session_id?: string }
        Returns: boolean
      }
      finalize_due_auctions: { Args: { p_at?: string }; Returns: number }
      get_approved_masked_security_logs: {
        Args: { p_limit?: number; p_offset?: number; p_request_id: string }
        Returns: {
          action: string
          actor_label: string
          category: string
          entity_id_masked: string
          entity_type: string
          event_type: string
          ip_address_masked: string
          log_key: string
          metadata: Json
          occurred_at: string
          severity: string
          source: string
          subject_label: string
          user_agent_masked: string
        }[]
      }
      get_auction_server_time: { Args: never; Returns: string }
      get_commerce_payment_status: {
        Args: never
        Returns: {
          active_mode: string
          configured: boolean
        }[]
      }
      get_current_owner_operator_delegation: {
        Args: never
        Returns: {
          created_at: string
          expires_at: string
          reason: string
          session_id: string
          target_display_name: string
          target_operator_id: string
        }[]
      }
      get_daily_revenue: {
        Args: { p_from: string; p_to: string }
        Returns: {
          gross_amount: number
          paid_order_count: number
          revenue_date: string
          updated_at: string
        }[]
      }
      get_manual_transfer_settings: {
        Args: never
        Returns: {
          account_number: string
          active_mode: string
          bank_name: string
          configured: boolean
          updated_at: string
        }[]
      }
      get_manual_transfer_status_for_service: {
        Args: { p_product_id: string }
        Returns: string
      }
      get_monthly_revenue: {
        Args: { p_from: string; p_to: string }
        Returns: {
          gross_amount: number
          paid_order_count: number
          period_end: string
          period_start: string
        }[]
      }
      get_my_enforcement_status: {
        Args: never
        Returns: {
          bid_blocked_until: string
          payment_deadline_exempt: boolean
          sanction_count: number
          warning_count: number
        }[]
      }
      get_my_nickname_state: {
        Args: never
        Returns: {
          can_change_once: boolean
          display_name: string
          is_initialized: boolean
          pending_nickname: string
          pending_request_id: string
        }[]
      }
      get_my_second_chance_offers: {
        Args: never
        Returns: {
          expires_at: string
          image_urls: string[]
          offer_id: string
          offered_amount: number
          offered_at: string
          product_id: string
          product_title: string
          status: string
        }[]
      }
      get_my_won_products: {
        Args: never
        Returns: {
          active_payment_mode: string
          closed_at: string
          final_bid_amount: number
          image_urls: string[]
          is_payment_settled: boolean
          manual_transfer_confirmed_at: string
          manual_transfer_order_id: string
          manual_transfer_requested_at: string
          manual_transfer_status: string
          payment_due_at: string
          payment_id: string
          payment_method: string
          payment_status: string
          portone_status: string
          product_id: string
          purchase_offer_id: string
          purchase_offer_kind: string
          purchase_offer_round: number
          purchase_offer_status: string
          requested_method: string
          shipment_request_id: string
          shipping_status: string
          title: string
          vbank_bank: string
          vbank_due: string
          vbank_num: string
        }[]
      }
      get_online_member_directory: {
        Args: { p_limit?: number }
        Returns: {
          display_name: string
          id: string
          is_operator: boolean
          total_count: number
        }[]
      }
      get_or_create_employee_support_conversation: {
        Args: never
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_or_create_product_inquiry_conversation: {
        Args: { p_product_id: string }
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_or_create_support_conversation: {
        Args: never
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_owner_hidden_test_member: {
        Args: never
        Returns: {
          account_status: string
          addresses: Json
          created_at: string
          display_name: string
          phone: string
          shipping_credit_count: number
          test_user_id: string
        }[]
      }
      get_owner_hidden_test_member_audit: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          action: string
          actor_owner_id: string
          audit_id: number
          occurred_at: string
          payload: Json
          target_test_user_id: string
        }[]
      }
      get_owner_hidden_test_member_for_service: {
        Args: { p_actor_owner_id: string; p_include_retired?: boolean }
        Returns: {
          retired_at: string
          test_user_id: string
        }[]
      }
      get_owner_hidden_test_shipping_requests: {
        Args: never
        Returns: {
          address_snapshot: Json
          courier: string
          product_ids: string[]
          request_id: string
          requested_at: string
          shipped_at: string
          status: string
          tracking_number: string
        }[]
      }
      get_owner_hidden_test_won_products: {
        Args: never
        Returns: {
          active_payment_mode: string
          closed_at: string
          final_bid_amount: number
          image_urls: string[]
          is_payment_settled: boolean
          manual_transfer_confirmed_at: string
          manual_transfer_order_id: string
          manual_transfer_requested_at: string
          manual_transfer_status: string
          payment_id: string
          payment_method: string
          payment_status: string
          portone_status: string
          product_id: string
          requested_method: string
          shipment_request_id: string
          shipping_status: string
          title: string
          vbank_bank: string
          vbank_due: string
          vbank_num: string
        }[]
      }
      get_owner_operator_delegation_audit: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          action: string
          actor_owner_id: string
          audit_id: number
          occurred_at: string
          payload: Json
          session_id: string
          target_operator_id: string
        }[]
      }
      get_owner_operator_directory: {
        Args: never
        Returns: {
          display_name: string
          email: string
          id: string
          last_seen_at: string
        }[]
      }
      get_payment_runtime_mode_for_service: { Args: never; Returns: string }
      get_pending_manual_transfers: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          account_number: string
          bank_name: string
          buyer_display_name: string
          buyer_id: string
          confirmed_at: string
          due_at: string
          expected_amount: number
          image_urls: string[]
          order_id: string
          payment_deadline_exempt: boolean
          product_id: string
          product_title: string
          purchase_offer_kind: string
          purchase_offer_round: number
          purchase_offer_status: string
          requested_at: string
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      get_pending_nickname_change_requests: {
        Args: never
        Returns: {
          current_nickname: string
          member_id: string
          request_id: string
          requested_at: string
          requested_nickname: string
        }[]
      }
      get_pending_shipping_work: {
        Args: never
        Returns: {
          address_snapshot: Json
          item_count: number
          product_ids: string[]
          request_id: string
          requested_at: string
        }[]
      }
      get_public_sold_auctions: {
        Args: { p_before?: string; p_before_id?: string; p_limit?: number }
        Returns: {
          description: string
          image_urls: string[]
          participant_count: number
          product_id: string
          sold_at: string
          thumbnail_urls: string[]
          title: string
          winner_display_name: string
          winning_amount: number
        }[]
      }
      get_shipping_work: {
        Args: {
          p_include_shipped?: boolean
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          address_snapshot: Json
          courier: string
          item_count: number
          member_id: string
          product_ids: string[]
          request_id: string
          requested_at: string
          shipped_at: string
          status: string
          total_count: number
          tracking_number: string
          updated_at: string
        }[]
      }
      get_staff_member_directory: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          access_role: string
          account_status: string
          address_count: number
          bid_blocked_until: string
          bid_count: number
          birth_year: number
          created_at: string
          display_name: string
          email: string
          gender: string
          id: string
          kakao_profile_complete: boolean
          kakao_synced_at: string
          last_seen_at: string
          legal_name: string
          payment_deadline_exempt: boolean
          phone: string
          sanction_count: number
          shipping_credit_count: number
          support_status: string
          warning_count: number
        }[]
      }
      get_weekly_revenue: {
        Args: { p_from: string; p_to: string }
        Returns: {
          gross_amount: number
          paid_order_count: number
          period_end: string
          period_start: string
        }[]
      }
      get_yearly_revenue: {
        Args: { p_from: string; p_to: string }
        Returns: {
          gross_amount: number
          paid_order_count: number
          period_end: string
          period_start: string
        }[]
      }
      has_kakao_identity: { Args: { p_user_id: string }; Returns: boolean }
      has_required_kakao_profile: { Args: never; Returns: boolean }
      insert_owner_hidden_test_member_audit: {
        Args: {
          p_action: string
          p_actor_owner_id: string
          p_payload?: Json
          p_target_test_user_id: string
        }
        Returns: number
      }
      insert_owner_operator_delegation_audit: {
        Args: {
          p_action: string
          p_actor_owner_id: string
          p_payload?: Json
          p_session_id: string
          p_target_operator_id: string
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_auction_blackout: { Args: { p_at?: string }; Returns: boolean }
      is_employee: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      is_operator: { Args: never; Returns: boolean }
      is_owner: { Args: never; Returns: boolean }
      is_owner_hidden_test_member: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      is_payment_deadline_exempt: {
        Args: { p_member_id: string }
        Returns: boolean
      }
      is_product_support_assignee: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      is_security_ip_blocked: { Args: { p_ip: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_support_operator: { Args: { p_user_id: string }; Returns: boolean }
      list_my_security_log_access_requests: {
        Args: never
        Returns: {
          access_expires_at: string
          created_at: string
          is_requester: boolean
          is_subject: boolean
          owner_decision: string
          reason: string
          request_expires_at: string
          request_id: string
          requested_from: string
          requested_to: string
          requester_display_name: string
          status: string
          subject_decision: string
          subject_display_name: string
        }[]
      }
      list_owner_operator_delegation_targets: {
        Args: never
        Returns: {
          display_name: string
          operator_id: string
        }[]
      }
      list_support_operators: {
        Args: never
        Returns: {
          display_name: string
          operator_id: string
        }[]
      }
      manage_past_auction_products: {
        Args: { p_action: string; p_product_ids: string[] }
        Returns: {
          processed_count: number
          processed_ids: string[]
          skipped_count: number
          skipped_ids: string[]
        }[]
      }
      mark_shipping_request_shipped: {
        Args: {
          p_courier: string
          p_request_id: string
          p_tracking_number: string
        }
        Returns: string
      }
      mark_support_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_reads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      next_auction_drop_at: { Args: { p_at: string }; Returns: string }
      normalize_member_nickname: {
        Args: { p_nickname: string }
        Returns: string
      }
      owner_begin_hidden_test_manual_transfer: {
        Args: { p_product_id: string }
        Returns: {
          account_number: string
          bank_name: string
          confirmed_at: string
          expected_amount: number
          is_payment_settled: boolean
          order_id: string
          order_name: string
          product_id: string
          requested_at: string
          status: string
          updated_at: string
        }[]
      }
      owner_close_auction_now: {
        Args: { p_product_id: string; p_reason?: string }
        Returns: {
          closed_at: string
          product_id: string
          status: string
          winner_bid_id: string
          winner_display_name: string
          winner_id: string
          winning_amount: number
        }[]
      }
      owner_create_ip_block_rule: {
        Args: {
          p_expires_at?: string
          p_label?: string
          p_network: string
          p_reason: string
          p_request_ip: string
        }
        Returns: string
      }
      owner_decide_security_log_access: {
        Args: {
          p_access_hours?: number
          p_approved: boolean
          p_note: string
          p_request_id: string
        }
        Returns: undefined
      }
      owner_delete_hidden_test_shipping_address: {
        Args: { p_address_id: string }
        Returns: boolean
      }
      owner_list_ip_block_rules: {
        Args: { p_include_archived?: boolean; p_reason: string }
        Returns: {
          archived_at: string
          created_at: string
          created_by: string
          enabled: boolean
          expires_at: string
          label: string
          network: string
          reason: string
          rule_id: string
          updated_at: string
          updated_by: string
        }[]
      }
      owner_list_security_activity: {
        Args: {
          p_category?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_reason: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          action: string
          actor_display_name: string
          actor_user_id: string
          category: string
          entity_id: string
          entity_type: string
          event_type: string
          ip_address: string
          log_key: string
          metadata: Json
          occurred_at: string
          severity: string
          source: string
          subject_display_name: string
          subject_user_id: string
          user_agent: string
        }[]
      }
      owner_list_security_log_access_requests: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_reason: string
          p_status?: string
          p_user_id?: string
        }
        Returns: {
          access_expires_at: string
          created_at: string
          is_requester: boolean
          is_subject: boolean
          owner_decision: string
          reason: string
          request_expires_at: string
          request_id: string
          requested_from: string
          requested_to: string
          requester_display_name: string
          requester_user_id: string
          status: string
          subject_decision: string
          subject_display_name: string
          subject_user_id: string
        }[]
      }
      owner_list_security_session_history: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_reason: string
          p_session_record_id: string
        }
        Returns: {
          display_name: string
          event_type: string
          history_id: number
          ip_address: string
          matched_rule_id: string
          observed_at: string
          outcome: string
          session_record_id: string
          user_agent: string
          user_id: string
        }[]
      }
      owner_list_security_sessions: {
        Args: {
          p_ip?: string
          p_limit?: number
          p_offset?: number
          p_outcome?: string
          p_reason: string
          p_user_id?: string
        }
        Returns: {
          auth_session_id: string
          browser_tab_session_id: string
          display_name: string
          first_seen_at: string
          last_event: string
          last_outcome: string
          last_seen_at: string
          latest_ip: string
          latest_user_agent: string
          matched_rule_id: string
          session_record_id: string
          user_id: string
        }[]
      }
      owner_mark_hidden_test_shipping_shipped: {
        Args: {
          p_courier: string
          p_request_id: string
          p_tracking_number: string
        }
        Returns: string
      }
      owner_override_auction_price: {
        Args: {
          p_current_price?: number
          p_product_id: string
          p_reason?: string
          p_starting_price?: number
        }
        Returns: {
          anti_sniping_base_closes_at: string | null
          anti_sniping_extended_at: string | null
          anti_sniping_extension_count: number
          auction_feed_expires_at: string | null
          bid_history: Json
          bid_increment: number
          bid_locked_at: string | null
          category: string
          closes_at: string
          condition_grade: string
          created_at: string
          created_by: string | null
          current_price: number
          description: string
          final_bid_amount: number | null
          final_bid_id: string | null
          fixed_price: number | null
          id: string
          image_urls: string[]
          inquiry_operator_id: string | null
          inspection_notes: string[]
          measurements: Json
          participant_count: number
          past_action: string | null
          past_at: string | null
          past_expires_at: string | null
          publish_at: string
          sale_type: string
          size_label: string
          starting_price: number
          status: string
          storage_class: string
          store_id: string | null
          thumbnail_urls: string[]
          title: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      owner_place_test_bid: {
        Args: {
          p_amount: number
          p_product_id: string
          p_reason?: string
          p_test_member_id: string
        }
        Returns: {
          amount: number
          bid_id: string
          bid_locked_at: string
          bidder_display_name: string
          bidder_id: string
          created_at: string
          current_price: number
          final_bid_id: string
          is_final: boolean
          participant_count: number
          product_id: string
        }[]
      }
      owner_request_hidden_test_shipping: {
        Args: { p_address_id: string; p_product_ids: string[] }
        Returns: string
      }
      owner_set_hidden_test_shipping_credits: {
        Args: { p_credit_count: number }
        Returns: number
      }
      owner_update_hidden_test_member_profile: {
        Args: { p_display_name: string; p_phone: string }
        Returns: undefined
      }
      owner_update_ip_block_rule: {
        Args: {
          p_archive?: boolean
          p_change_reason: string
          p_clear_expires_at?: boolean
          p_clear_label?: boolean
          p_enabled?: boolean
          p_expires_at?: string
          p_label?: string
          p_network?: string
          p_reason?: string
          p_request_ip: string
          p_rule_id: string
        }
        Returns: undefined
      }
      owner_upsert_hidden_test_shipping_address: {
        Args: {
          p_address: string
          p_id: string
          p_is_default?: boolean
          p_label: string
          p_phone: string
          p_recipient_name: string
        }
        Returns: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          member_id: string
          phone: string
          postal_code: string | null
          recipient_name: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shipping_addresses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      place_bid: {
        Args: { p_amount: number; p_product_id: string }
        Returns: {
          amount: number
          bid_id: string
          bid_locked_at: string
          bidder_display_name: string
          bidder_id: string
          created_at: string
          current_price: number
          final_bid_id: string
          is_final: boolean
          participant_count: number
          product_id: string
        }[]
      }
      portone_payment_status_label: {
        Args: { p_status: string }
        Returns: string
      }
      portone_payment_status_rank: {
        Args: { p_status: string }
        Returns: number
      }
      prepare_portone_payment: {
        Args: {
          p_member_id: string
          p_payment_id: string
          p_product_id: string
          p_requested_method: string
          p_store_id: string
        }
        Returns: {
          expected_amount: number
          order_name: string
          payment_id: string
          payment_status: string
          product_id: string
        }[]
      }
      process_auction_purchase_offers: {
        Args: { p_at?: string }
        Returns: number
      }
      provision_owner_hidden_test_member: {
        Args: {
          p_actor_owner_id: string
          p_label?: string
          p_test_user_id: string
        }
        Returns: string
      }
      publish_pending_products_now: {
        Args: { p_product_ids: string[] }
        Returns: {
          closes_at: string
          published_at: string
          published_count: number
          published_ids: string[]
          requested_count: number
          skipped_count: number
          skipped_ids: string[]
        }[]
      }
      record_owner_operator_delegated_action: {
        Args: { p_action: string; p_payload?: Json; p_session_id: string }
        Returns: string
      }
      record_security_session_event: {
        Args: {
          p_auth_session_id: string
          p_client_session_id: string
          p_event_type: string
          p_ip: string
          p_user_agent: string
          p_user_id: string
        }
        Returns: {
          allowed: boolean
          matched_rule_id: string
          recorded: boolean
          session_record_id: string
        }[]
      }
      reopen_my_support_conversation: {
        Args: never
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reopen_support_conversation: {
        Args: { p_conversation_id: string }
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_my_nickname_change: {
        Args: { p_nickname: string }
        Returns: string
      }
      request_product_shipping:
        | {
            Args: { p_address_id: string; p_product_ids: string[] }
            Returns: string
          }
        | {
            Args: {
              p_address_id: string
              p_apply_shipping_credit?: boolean
              p_product_ids: string[]
            }
            Returns: string
          }
        | {
            Args: {
              p_address_id: string
              p_apply_shipping_credit: boolean
              p_idempotency_key: string
              p_product_ids: string[]
            }
            Returns: string
          }
      request_security_log_access: {
        Args: {
          p_reason: string
          p_requested_from: string
          p_requested_to: string
          p_subject_display_name?: string
        }
        Returns: string
      }
      respond_security_log_subject_consent: {
        Args: { p_approved: boolean; p_note?: string; p_request_id: string }
        Returns: undefined
      }
      retire_owner_hidden_test_member: {
        Args: { p_actor_owner_id: string; p_test_user_id: string }
        Returns: boolean
      }
      review_nickname_change_request: {
        Args: {
          p_approve: boolean
          p_request_id: string
          p_review_note?: string
        }
        Returns: string
      }
      revoke_security_log_access: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      set_member_access_role: {
        Args: { p_member_id: string; p_role_code: string }
        Returns: string
      }
      set_member_account_status: {
        Args: { p_member_id: string; p_status: string }
        Returns: string
      }
      set_my_initial_nickname: { Args: { p_nickname: string }; Returns: string }
      set_payment_runtime_mode: {
        Args: { p_active_mode: string }
        Returns: string
      }
      sync_manual_transfer_runtime_settings: {
        Args: { p_account_number: string; p_bank_name: string }
        Returns: boolean
      }
      start_product_inquiry: {
        Args: { p_body: string; p_client_nonce: string; p_product_id: string }
        Returns: {
          assigned_staff_id: string | null
          conversation_type: string
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          last_sender_id: string | null
          member_id: string
          product_id: string | null
          product_image_url_snapshot: string | null
          product_title_snapshot: string | null
          status: string
          subject: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "support_conversations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      support_access_role: { Args: { p_user_id?: string }; Returns: string }
      support_employee_operator: {
        Args: { p_employee_id: string }
        Returns: string
      }
      sync_portone_payment: {
        Args: {
          p_amount: number
          p_currency: string
          p_paid_at: string
          p_payment_id: string
          p_payment_method: string
          p_portone_status: string
          p_status_changed_at: string
          p_store_id: string
          p_vbank_bank: string
          p_vbank_due: string
          p_vbank_num: string
        }
        Returns: {
          payment_status: string
          portone_status: string
        }[]
      }
      touch_my_last_seen: { Args: never; Returns: string }
      update_managed_member: {
        Args: { p_display_name: string; p_member_id: string; p_phone: string }
        Returns: undefined
      }
      update_managed_product: {
        Args: {
          p_bid_increment: number
          p_description: string
          p_expected_updated_at: string
          p_product_id: string
          p_publish_at: string
          p_starting_price: number
          p_status: string
          p_title: string
        }
        Returns: {
          anti_sniping_base_closes_at: string | null
          anti_sniping_extended_at: string | null
          anti_sniping_extension_count: number
          auction_feed_expires_at: string | null
          bid_history: Json
          bid_increment: number
          bid_locked_at: string | null
          category: string
          closes_at: string
          condition_grade: string
          created_at: string
          created_by: string | null
          current_price: number
          description: string
          final_bid_amount: number | null
          final_bid_id: string | null
          fixed_price: number | null
          id: string
          image_urls: string[]
          inquiry_operator_id: string | null
          inspection_notes: string[]
          measurements: Json
          participant_count: number
          past_action: string | null
          past_at: string | null
          past_expires_at: string | null
          publish_at: string
          sale_type: string
          size_label: string
          starting_price: number
          status: string
          storage_class: string
          store_id: string | null
          thumbnail_urls: string[]
          title: string
          updated_at: string
          updated_by: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      update_manual_transfer_settings: {
        Args: { p_account_number: string; p_bank_name: string }
        Returns: {
          account_number: string
          active_mode: string
          bank_name: string
          configured: boolean
          updated_at: string
        }[]
      }
      upsert_daily_revenue: {
        Args: {
          p_gross_amount: number
          p_paid_order_count: number
          p_revenue_date: string
        }
        Returns: {
          gross_amount: number
          paid_order_count: number
          revenue_date: string
          updated_at: string
        }[]
      }
      upsert_my_shipping_address: {
        Args: {
          p_address: string
          p_id: string
          p_is_default?: boolean
          p_label: string
          p_phone: string
          p_postal_code?: string
          p_recipient_name: string
        }
        Returns: {
          address: string
          created_at: string
          id: string
          is_default: boolean
          label: string
          member_id: string
          phone: string
          postal_code: string | null
          recipient_name: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shipping_addresses"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      upsert_shipping_tracking_batch: {
        Args: { p_updates: Json }
        Returns: {
          courier: string
          request_id: string
          shipped_at: string
          status: string
          tracking_number: string
          updated_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
