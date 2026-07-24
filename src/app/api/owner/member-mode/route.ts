import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";
import {
  OWNER_MEMBER_MODE_DURATION_MS,
  TEMPORARY_MEMBER_OWNER_ID,
} from "@/lib/ownerMemberMode";
import { getOwnerMemberModeState } from "@/lib/ownerMemberMode.server";

async function readAuthorizedState(request: Request, mutation = false) {
  const auth = await authenticateCommerceRequest(request, mutation);
  if (!auth.ok) return auth;

  try {
    const state = await getOwnerMemberModeState(auth.admin, auth.userId);
    return { ...auth, state };
  } catch {
    return {
      ok: false as const,
      response: commerceJson(
        {
          error: "owner_member_mode_unavailable",
          message: "임시 회원 권한 상태를 확인하지 못했습니다.",
        },
        503,
      ),
    };
  }
}

export async function GET(request: Request) {
  const auth = await readAuthorizedState(request);
  if (!auth.ok) return auth.response;
  return commerceJson(auth.state);
}

export async function POST(request: Request) {
  const auth = await readAuthorizedState(request, true);
  if (!auth.ok) return auth.response;
  if (
    auth.userId !== TEMPORARY_MEMBER_OWNER_ID ||
    !auth.state.eligible
  ) {
    return commerceJson(
      {
        error: "owner_required",
        message: "지정된 소유자 계정만 임시 회원 권한을 사용할 수 있습니다.",
      },
      403,
    );
  }

  const body = await request.json().catch(() => null) as
    | { action?: unknown }
    | null;
  const action = body?.action;
  if (action !== "activate" && action !== "extend" && action !== "end") {
    return commerceJson(
      { error: "invalid_action", message: "요청한 권한 동작을 확인해 주세요." },
      400,
    );
  }

  const now = new Date();
  if (action === "end") {
    const { error } = await auth.admin
      .from("owner_member_mode_sessions")
      .update({
        ended_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("owner_id", auth.userId);
    if (error) {
      return commerceJson(
        {
          error: "owner_member_mode_update_failed",
          message: "회원 권한을 종료하지 못했습니다.",
        },
        503,
      );
    }
    return commerceJson({
      active: false,
      eligible: true,
      expiresAt: null,
    });
  }

  const currentExpiry = auth.state.expiresAt
    ? new Date(auth.state.expiresAt).getTime()
    : 0;
  const baseTime =
    action === "extend" && auth.state.active
      ? Math.max(now.getTime(), currentExpiry)
      : now.getTime();
  const expiresAt = new Date(
    baseTime + OWNER_MEMBER_MODE_DURATION_MS,
  ).toISOString();
  const { error } = await auth.admin
    .from("owner_member_mode_sessions")
    .upsert(
      {
        owner_id: auth.userId,
        activated_at:
          action === "activate" || !auth.state.active
            ? now.toISOString()
            : new Date(
                currentExpiry - OWNER_MEMBER_MODE_DURATION_MS,
              ).toISOString(),
        ended_at: null,
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      },
      { onConflict: "owner_id" },
    );
  if (error) {
    return commerceJson(
      {
        error: "owner_member_mode_update_failed",
        message: "임시 회원 권한 시간을 변경하지 못했습니다.",
      },
      503,
    );
  }

  return commerceJson({ active: true, eligible: true, expiresAt });
}
