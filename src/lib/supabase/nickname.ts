import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "./client";

interface NicknameStateRow {
  display_name: string;
  is_initialized: boolean;
  can_change_once: boolean;
  pending_request_id: string | null;
  pending_nickname: string | null;
}

interface NicknameRequestRow {
  request_id: string;
  member_id: string;
  current_nickname: string;
  requested_nickname: string;
  requested_at: string;
}

export interface NicknameState {
  displayName: string;
  isInitialized: boolean;
  canChangeOnce: boolean;
  pendingRequestId: string | null;
  pendingNickname: string | null;
}

export interface PendingNicknameChangeRequest {
  id: string;
  memberId: string;
  currentNickname: string;
  requestedNickname: string;
  requestedAt: string;
}

export class NicknameError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NicknameError";
  }
}

function getNicknameClient(): SupabaseClient {
  return getSupabaseBrowserClient() as unknown as SupabaseClient;
}

function toNicknameError(
  error: Pick<PostgrestError, "message"> | null,
  fallback: string,
): NicknameError {
  return new NicknameError(error?.message || fallback, { cause: error ?? undefined });
}

function normalizeNicknameInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function assertNickname(value: string): string {
  const nickname = normalizeNicknameInput(value);
  if (nickname.length < 2 || nickname.length > 20) {
    throw new NicknameError("닉네임은 2자 이상 20자 이하로 입력해 주세요.");
  }
  return nickname;
}

function mapState(row: NicknameStateRow): NicknameState {
  return {
    displayName: row.display_name,
    isInitialized: row.is_initialized,
    canChangeOnce: row.can_change_once,
    pendingRequestId: row.pending_request_id,
    pendingNickname: row.pending_nickname,
  };
}

export async function getMyNicknameState(): Promise<NicknameState> {
  const { data, error } = await getNicknameClient().rpc("get_my_nickname_state");
  if (error) throw toNicknameError(error, "닉네임 상태를 불러오지 못했습니다.");
  const row = (data as NicknameStateRow[] | null)?.[0];
  if (!row) throw new NicknameError("닉네임 프로필을 찾지 못했습니다.");
  return mapState(row);
}

export async function setMyInitialNickname(nickname: string): Promise<string> {
  const { data, error } = await getNicknameClient().rpc(
    "set_my_initial_nickname",
    { p_nickname: assertNickname(nickname) },
  );
  if (error) throw toNicknameError(error, "닉네임을 설정하지 못했습니다.");
  return String(data);
}

export async function requestMyNicknameChange(nickname: string): Promise<string> {
  const { data, error } = await getNicknameClient().rpc(
    "request_my_nickname_change",
    { p_nickname: assertNickname(nickname) },
  );
  if (error) throw toNicknameError(error, "닉네임 변경 승인을 요청하지 못했습니다.");
  return String(data);
}

export async function getPendingNicknameChangeRequests(): Promise<
  PendingNicknameChangeRequest[]
> {
  const { data, error } = await getNicknameClient().rpc(
    "get_pending_nickname_change_requests",
  );
  if (error) throw toNicknameError(error, "닉네임 승인 요청을 불러오지 못했습니다.");
  return ((data ?? []) as NicknameRequestRow[]).map((row) => ({
    id: row.request_id,
    memberId: row.member_id,
    currentNickname: row.current_nickname,
    requestedNickname: row.requested_nickname,
    requestedAt: row.requested_at,
  }));
}

export async function reviewNicknameChangeRequest(
  requestId: string,
  approve: boolean,
  reviewNote = "",
): Promise<"approved" | "rejected"> {
  const { data, error } = await getNicknameClient().rpc(
    "review_nickname_change_request",
    {
      p_request_id: requestId,
      p_approve: approve,
      p_review_note: reviewNote.trim() || null,
    },
  );
  if (error) throw toNicknameError(error, "닉네임 요청을 처리하지 못했습니다.");
  if (data !== "approved" && data !== "rejected") {
    throw new NicknameError("닉네임 요청 처리 결과를 확인하지 못했습니다.");
  }
  return data;
}
