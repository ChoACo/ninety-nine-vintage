import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./client";

export const MAX_SUPPORT_MESSAGE_LENGTH = 2_000;

export type SupportViewerRole = "member" | "employee" | "operator" | "admin";
export type SupportStaffRole = Extract<SupportViewerRole, "operator" | "admin">;
export type SupportConversationStatus = "open" | "closed";
export type SupportConversationType = "general" | "product" | "internal";

export interface SupportProfile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportConversation {
  id: string;
  memberId: string;
  assignedStaffId: string | null;
  conversationType: SupportConversationType;
  productId: string | null;
  subject: string | null;
  productTitleSnapshot: string | null;
  productImageUrlSnapshot: string | null;
  status: SupportConversationStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastSenderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  clientNonce: string;
  createdAt: string;
}

export interface SupportReadReceipt {
  conversationId: string;
  userId: string;
  lastReadAt: string;
}

export interface SupportInboxConversation extends SupportConversation {
  member: SupportProfile | null;
  assignedStaff: SupportProfile | null;
  isUnread: boolean;
}

export interface SupportMemberConversation extends SupportConversation {
  isUnread: boolean;
}

export interface SupportOperator {
  id: string;
  displayName: string;
}

export interface SupportChatSubscriptionHandlers {
  onSubscribed?: () => void;
  onConversationChange?: () => void;
  onMessageChange?: (message: SupportMessage | null) => void;
  onProfileChange?: () => void;
  onReadChange?: () => void;
  onError?: (error: SupportChatError) => void;
}

export class SupportChatError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown; code?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SupportChatError";
    this.code = options?.code;
  }
}

interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  member_id: string;
  assigned_staff_id: string | null;
  conversation_type: SupportConversationType;
  product_id: string | null;
  subject: string | null;
  product_title_snapshot: string | null;
  product_image_url_snapshot: string | null;
  status: SupportConversationStatus;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_sender_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  client_nonce: string;
  created_at: string;
}

interface ReadRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
}

interface OperatorRow {
  operator_id: string;
  display_name: string;
}

export type SupportChatDatabase = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: {
          id: string;
          display_name: string;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      support_conversations: {
        Row: ConversationRow;
        Insert: {
          id?: string;
          member_id: string;
          assigned_staff_id?: string | null;
          conversation_type?: SupportConversationType;
          product_id?: string | null;
          subject?: string | null;
          product_title_snapshot?: string | null;
          product_image_url_snapshot?: string | null;
          status?: SupportConversationStatus;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          last_sender_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: SupportConversationStatus;
          updated_at?: string;
        };
        Relationships: [];
      };
      support_messages: {
        Row: MessageRow;
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          client_nonce?: string;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      support_reads: {
        Row: ReadRow;
        Insert: {
          conversation_id: string;
          user_id: string;
          last_read_at?: string;
        };
        Update: { last_read_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_or_create_support_conversation: {
        Args: Record<PropertyKey, never>;
        Returns: ConversationRow[];
      };
      start_product_inquiry: {
        Args: {
          p_product_id: string;
          p_body: string;
          p_client_nonce: string;
        };
        Returns: ConversationRow[];
      };
      get_or_create_employee_support_conversation: {
        Args: Record<PropertyKey, never>;
        Returns: ConversationRow[];
      };
      mark_support_conversation_read: {
        Args: { p_conversation_id: string };
        Returns: ReadRow[];
      };
      reopen_my_support_conversation: {
        Args: Record<PropertyKey, never>;
        Returns: ConversationRow[];
      };
      reopen_support_conversation: {
        Args: { p_conversation_id: string };
        Returns: ConversationRow[];
      };
      list_support_operators: {
        Args: Record<PropertyKey, never>;
        Returns: OperatorRow[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

function getSupportClient(): SupabaseClient {
  // Chat tables are deployed by a migration that can land before generated
  // Database types are refreshed. Domain rows are normalized below so the UI
  // does not depend on that generated file.
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function toProfile(row: ProfileRow): SupportProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConversation(row: ConversationRow): SupportConversation {
  return {
    id: row.id,
    memberId: row.member_id,
    assignedStaffId: row.assigned_staff_id,
    conversationType: row.conversation_type,
    productId: row.product_id,
    subject: row.subject,
    productTitleSnapshot: row.product_title_snapshot,
    productImageUrlSnapshot: row.product_image_url_snapshot,
    status: row.status,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastSenderId: row.last_sender_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow): SupportMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    clientNonce: row.client_nonce,
    createdAt: row.created_at,
  };
}

function toReadReceipt(row: ReadRow): SupportReadReceipt {
  return {
    conversationId: row.conversation_id,
    userId: row.user_id,
    lastReadAt: row.last_read_at,
  };
}

function throwQueryError(
  error: { message: string; code?: string } | null,
  fallbackMessage: string,
): void {
  if (!error) return;

  throw new SupportChatError(fallbackMessage, {
    cause: error,
    code: error.code,
  });
}

function normalizeMessageBody(body: string): string {
  const normalized = body.trim();

  if (!normalized) {
    throw new SupportChatError("메시지 내용을 입력해 주세요.", {
      code: "message_empty",
    });
  }

  if (normalized.length > MAX_SUPPORT_MESSAGE_LENGTH) {
    throw new SupportChatError(
      `메시지는 ${MAX_SUPPORT_MESSAGE_LENGTH.toLocaleString("ko-KR")}자까지 보낼 수 있어요.`,
      { code: "message_too_long" },
    );
  }

  return normalized;
}

function createClientNonce(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  throw new SupportChatError("안전한 메시지 식별자를 만들 수 없는 브라우저예요.", {
    code: "random_uuid_unavailable",
  });
}

export function isSupportStaffRole(
  role: SupportViewerRole | null | undefined,
): role is SupportStaffRole {
  return role === "admin" || role === "operator";
}

export async function getOrCreateMemberSupportConversation(): Promise<SupportConversation> {
  const { data, error } = await getSupportClient().rpc(
    "get_or_create_support_conversation",
  );
  throwQueryError(error, "상담 대화를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("상담 대화를 찾지 못했어요.", {
      code: "conversation_not_found",
    });
  }

  return toConversation(row);
}

export async function startProductInquiry(
  productId: string,
  body: string,
): Promise<SupportConversation> {
  const normalizedBody = normalizeMessageBody(body);
  const { data, error } = await getSupportClient().rpc(
    "start_product_inquiry",
    {
      p_product_id: productId,
      p_body: normalizedBody,
      p_client_nonce: createClientNonce(),
    },
  );
  throwQueryError(error, "상품 문의를 전송하지 못했어요. 잠시 후 다시 시도해 주세요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("전송한 상품 문의를 찾지 못했어요.", {
      code: "conversation_not_found",
    });
  }

  return toConversation(row);
}

export async function getOrCreateEmployeeSupportConversation(): Promise<SupportConversation> {
  const { data, error } = await getSupportClient().rpc(
    "get_or_create_employee_support_conversation",
  );
  throwQueryError(error, "내부 운영 대화를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("내부 운영 대화를 찾지 못했어요.", {
      code: "conversation_not_found",
    });
  }

  return toConversation(row);
}

export async function fetchMemberSupportConversation(
  userId: string,
): Promise<SupportConversation | null> {
  const { data, error } = await getSupportClient()
    .from("support_conversations")
    .select("*")
    .eq("member_id", userId)
    .eq("conversation_type", "general")
    .maybeSingle();
  throwQueryError(error, "상담 대화를 불러오지 못했어요.");

  return data ? toConversation(data) : null;
}

export async function fetchEmployeeSupportConversation(
  userId: string,
): Promise<SupportConversation | null> {
  const { data, error } = await getSupportClient()
    .from("support_conversations")
    .select("*")
    .eq("member_id", userId)
    .eq("conversation_type", "internal")
    .maybeSingle();
  throwQueryError(error, "내부 운영 대화를 불러오지 못했어요.");

  return data ? toConversation(data) : null;
}

export async function reopenMemberSupportConversation(): Promise<SupportConversation> {
  const { data, error } = await getSupportClient().rpc(
    "reopen_my_support_conversation",
  );
  throwQueryError(error, "상담을 다시 열지 못했어요. 잠시 후 다시 시도해 주세요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("다시 열 상담을 찾지 못했어요.", {
      code: "conversation_not_found",
    });
  }

  return toConversation(row);
}

export async function reopenSupportConversation(
  conversationId: string,
): Promise<SupportConversation> {
  const { data, error } = await getSupportClient().rpc(
    "reopen_support_conversation",
    { p_conversation_id: conversationId },
  );
  throwQueryError(error, "대화를 다시 열지 못했어요. 잠시 후 다시 시도해 주세요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("다시 열 대화를 찾지 못했어요.", {
      code: "conversation_not_found",
    });
  }

  return toConversation(row);
}

export async function fetchSupportConversation(
  conversationId: string,
): Promise<SupportConversation> {
  const { data, error } = await getSupportClient()
    .from("support_conversations")
    .select("*")
    .eq("id", conversationId)
    .single();
  throwQueryError(error, "상담 대화를 불러오지 못했어요.");

  return toConversation(data);
}

export async function fetchSupportMessages(
  conversationId: string,
): Promise<SupportMessage[]> {
  const { data, error } = await getSupportClient()
    .from("support_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  throwQueryError(error, "상담 메시지를 불러오지 못했어요.");

  return (data ?? []).map(toMessage);
}

export async function fetchSupportProfiles(
  profileIds: readonly string[],
): Promise<Map<string, SupportProfile>> {
  const uniqueIds = [...new Set(profileIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await getSupportClient()
    .from("profiles")
    .select("*")
    .in("id", uniqueIds);
  throwQueryError(error, "상담 참여자 정보를 불러오지 못했어요.");

  return new Map((data ?? []).map((row) => [row.id, toProfile(row)]));
}

export async function fetchSupportReadReceipts(
  userId: string,
): Promise<Map<string, SupportReadReceipt>> {
  const { data, error } = await getSupportClient()
    .from("support_reads")
    .select("*")
    .eq("user_id", userId);
  throwQueryError(error, "상담 읽음 상태를 불러오지 못했어요.");

  return new Map(
    (data ?? []).map((row) => [row.conversation_id, toReadReceipt(row)]),
  );
}

export async function fetchMemberSupportThreads(
  userId: string,
): Promise<SupportMemberConversation[]> {
  const client = getSupportClient();
  const [conversationResult, readResult] = await Promise.all([
    client
      .from("support_conversations")
      .select("*")
      .eq("member_id", userId)
      .in("conversation_type", ["general", "product"])
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    client.from("support_reads").select("*").eq("user_id", userId),
  ]);

  throwQueryError(conversationResult.error, "상담 대화 목록을 불러오지 못했어요.");
  throwQueryError(readResult.error, "상담 읽음 상태를 불러오지 못했어요.");

  const reads = new Map(
    (readResult.data ?? []).map((row) => [row.conversation_id, toReadReceipt(row)]),
  );

  return (conversationResult.data ?? []).map((row) => {
    const conversation = toConversation(row);
    return {
      ...conversation,
      isUnread: isConversationUnread(
        conversation,
        userId,
        reads.get(conversation.id),
      ),
    };
  });
}

export function isConversationUnread(
  conversation: SupportConversation,
  viewerId: string,
  readReceipt?: SupportReadReceipt,
): boolean {
  if (!conversation.lastMessageAt || conversation.lastSenderId === viewerId) {
    return false;
  }

  return !readReceipt || conversation.lastMessageAt > readReceipt.lastReadAt;
}

export async function fetchStaffSupportInbox(
  staffId: string,
  inboxOperatorId: string,
): Promise<SupportInboxConversation[]> {
  const client = getSupportClient();
  const conversationQuery = client
    .from("support_conversations")
    .select("*")
    .eq("assigned_staff_id", inboxOperatorId)
    .not("last_message_at", "is", null)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const [conversationResult, readResult] = await Promise.all([
    conversationQuery,
    client.from("support_reads").select("*").eq("user_id", staffId),
  ]);

  throwQueryError(conversationResult.error, "상담 대화함을 불러오지 못했어요.");
  throwQueryError(readResult.error, "상담 읽음 상태를 불러오지 못했어요.");

  const conversations = (conversationResult.data ?? []).map(toConversation);
  const profileIds = conversations.flatMap((conversation) =>
    conversation.assignedStaffId
      ? [conversation.memberId, conversation.assignedStaffId]
      : [conversation.memberId],
  );
  const profiles = await fetchSupportProfiles(profileIds);
  const reads = new Map(
    (readResult.data ?? []).map((row) => [row.conversation_id, toReadReceipt(row)]),
  );

  return conversations.map((conversation) => ({
    ...conversation,
    member: profiles.get(conversation.memberId) ?? null,
    assignedStaff: conversation.assignedStaffId
      ? profiles.get(conversation.assignedStaffId) ?? null
      : null,
    isUnread: isConversationUnread(
      conversation,
      staffId,
      reads.get(conversation.id),
    ),
  }));
}

export async function fetchSupportOperators(): Promise<SupportOperator[]> {
  const { data, error } = await getSupportClient().rpc("list_support_operators");
  throwQueryError(error, "운영자 상담함 목록을 불러오지 못했어요.");

  return (data ?? []).map((row: OperatorRow) => ({
    id: row.operator_id,
    displayName: row.display_name,
  }));
}

export async function sendSupportMessage(
  conversationId: string,
  senderId: string,
  body: string,
): Promise<SupportMessage> {
  const normalizedBody = normalizeMessageBody(body);
  const { data, error } = await getSupportClient()
    .from("support_messages")
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      body: normalizedBody,
      client_nonce: createClientNonce(),
    })
    .select("*")
    .single();
  throwQueryError(error, "메시지를 보내지 못했어요. 잠시 후 다시 시도해 주세요.");

  return toMessage(data);
}

export async function markSupportConversationRead(
  conversationId: string,
): Promise<SupportReadReceipt> {
  const { data, error } = await getSupportClient().rpc(
    "mark_support_conversation_read",
    { p_conversation_id: conversationId },
  );
  throwQueryError(error, "상담 읽음 상태를 저장하지 못했어요.");

  const row = data?.[0];
  if (!row) {
    throw new SupportChatError("상담 읽음 상태를 확인하지 못했어요.");
  }

  return toReadReceipt(row);
}

export async function updateSupportConversation(
  conversationId: string,
  updates: {
    status?: SupportConversationStatus;
  },
): Promise<SupportConversation> {
  const payload: {
    status?: SupportConversationStatus;
  } = {};

  if (updates.status) payload.status = updates.status;

  const { data, error } = await getSupportClient()
    .from("support_conversations")
    .update(payload)
    .eq("id", conversationId)
    .select("*")
    .single();
  throwQueryError(error, "상담 상태를 변경하지 못했어요.");

  return toConversation(data);
}

function makeChannelName(prefix: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${suffix}`;
}

function messageFromPayload(
  payload: RealtimePostgresChangesPayload<MessageRow>,
): SupportMessage | null {
  if (payload.eventType === "DELETE" || !("id" in payload.new)) return null;

  return toMessage(payload.new as MessageRow);
}

function attachSubscriptionStatusHandler(
  channel: RealtimeChannel,
  handlers: SupportChatSubscriptionHandlers,
): RealtimeChannel {
  return channel.subscribe((status, error) => {
    if (status === "SUBSCRIBED") {
      handlers.onSubscribed?.();
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      handlers.onError?.(
        new SupportChatError("실시간 상담 연결이 끊겼어요. 새로고침해 주세요.", {
          cause: error,
          code: "realtime_disconnected",
        }),
      );
    }
  });
}

export function subscribeToMemberSupportChat(
  conversationId: string,
  memberId: string,
  handlers: SupportChatSubscriptionHandlers,
): () => void {
  const client = getSupportClient();
  const channel = client
    .channel(makeChannelName(`support-member-${conversationId}`))
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_conversations",
        filter: `id=eq.${conversationId}`,
      },
      handlers.onConversationChange ?? (() => undefined),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) =>
        handlers.onMessageChange?.(
          messageFromPayload(
            payload as RealtimePostgresChangesPayload<MessageRow>,
          ),
        ),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${memberId}`,
      },
      handlers.onProfileChange ?? (() => undefined),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_reads",
        filter: `user_id=eq.${memberId}`,
      },
      handlers.onReadChange ?? (() => undefined),
    );

  attachSubscriptionStatusHandler(channel, handlers);
  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeToMemberSupportThreads(
  memberId: string,
  handlers: SupportChatSubscriptionHandlers,
): () => void {
  const client = getSupportClient();
  const channel = client
    .channel(makeChannelName(`support-member-threads-${memberId}`))
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_conversations",
        filter: `member_id=eq.${memberId}`,
      },
      handlers.onConversationChange ?? (() => undefined),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_messages" },
      (payload) =>
        handlers.onMessageChange?.(
          messageFromPayload(
            payload as RealtimePostgresChangesPayload<MessageRow>,
          ),
        ),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_reads",
        filter: `user_id=eq.${memberId}`,
      },
      handlers.onReadChange ?? (() => undefined),
    );

  attachSubscriptionStatusHandler(channel, handlers);
  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeToStaffSupportInbox(
  staffId: string,
  inboxOperatorId: string,
  handlers: SupportChatSubscriptionHandlers,
): () => void {
  const client = getSupportClient();
  const channel = client
    .channel(makeChannelName(`support-staff-${staffId}`))
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_conversations",
        filter: `assigned_staff_id=eq.${inboxOperatorId}`,
      },
      handlers.onConversationChange ?? (() => undefined),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "support_messages" },
      (payload) =>
        handlers.onMessageChange?.(
          messageFromPayload(
            payload as RealtimePostgresChangesPayload<MessageRow>,
          ),
        ),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles" },
      handlers.onProfileChange ?? (() => undefined),
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "support_reads",
        filter: `user_id=eq.${staffId}`,
      },
      handlers.onReadChange ?? (() => undefined),
    );

  attachSubscriptionStatusHandler(channel, handlers);
  return () => {
    void client.removeChannel(channel);
  };
}
