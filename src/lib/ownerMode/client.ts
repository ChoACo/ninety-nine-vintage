import { getSupabaseBrowserClient } from "@/src/lib/supabase/client";

export interface OwnerModeStatus {
  unlocked: boolean;
  expiresAt: string | null;
}

export class OwnerModeClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "OwnerModeClientError";
    this.code = code;
    this.status = status;
  }
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new OwnerModeClientError(
      "로그인 상태를 다시 확인해 주세요.",
      "unauthorized",
      401,
    );
  }
  return accessToken;
}

function messageForError(code: string, status: number): string {
  if (status === 429 || code === "temporarily_locked") {
    return "PIN 확인이 잠시 제한되었습니다. 15분 뒤 다시 시도해 주세요.";
  }
  if (status === 401) return "로그인 상태를 다시 확인해 주세요.";
  if (status === 403) return "PIN 또는 전용 모드 접근 권한을 확인해 주세요.";
  if (code === "owner_mode_not_configured") {
    return "전용 모드 서버 설정이 완료되지 않았습니다.";
  }
  return "전용 모드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function ownerModeRequest(
  path: "unlock" | "status" | "lock",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const accessToken = await getAccessToken();
  const response = await fetch(`/api/owner-mode/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : "unknown";
    throw new OwnerModeClientError(
      messageForError(code, response.status),
      code,
      response.status,
    );
  }
  return payload;
}

function toStatus(payload: Record<string, unknown>): OwnerModeStatus {
  return {
    unlocked: payload.unlocked === true,
    expiresAt:
      typeof payload.expiresAt === "string" ? payload.expiresAt : null,
  };
}

export async function unlockOwnerMode(pin: string): Promise<OwnerModeStatus> {
  const status = toStatus(await ownerModeRequest("unlock", { pin }));
  if (!status.unlocked || !status.expiresAt) {
    throw new OwnerModeClientError(
      "전용 모드 세션을 확인하지 못했습니다.",
      "invalid_session",
      500,
    );
  }
  return status;
}

export async function getOwnerModeStatus(): Promise<OwnerModeStatus> {
  return toStatus(await ownerModeRequest("status"));
}

export async function lockOwnerMode(): Promise<void> {
  await ownerModeRequest("lock");
}
