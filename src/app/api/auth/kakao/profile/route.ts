import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  clearHttpOnlyCookie,
  getKakaoFlowCookieName,
  hasTrustedRequestOrigin,
  KAKAO_ACCESS_TOKEN_COOKIE,
  KAKAO_USERINFO_ENDPOINT,
  normalizeKakaoFlowId,
  readCookie,
} from "@/src/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/src/lib/supabase/server";

interface KakaoUserInfo {
  sub?: unknown;
  name?: unknown;
  gender?: unknown;
  birthdate?: unknown;
}

function jsonResponse(
  requestUrl: string,
  body: Record<string, unknown>,
  status: number,
  accessTokenCookieName: string | null = KAKAO_ACCESS_TOKEN_COOKIE,
  clearAccessToken = true,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (clearAccessToken && accessTokenCookieName) {
    headers.append(
      "Set-Cookie",
      clearHttpOnlyCookie(requestUrl, accessTokenCookieName),
    );
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function normalizeString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function normalizeGender(value: unknown): "female" | "male" | null {
  const normalized = normalizeString(value, 16)?.toLowerCase();
  return normalized === "female" || normalized === "male" ? normalized : null;
}

function normalizeBirthYear(value: unknown): number | null {
  const normalized = normalizeString(value, 10);
  const match = normalized?.match(/^(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

function userHasKakaoSubject(user: User, subject: string): boolean {
  return user.identities?.some((identity) => {
    if (identity.provider !== "kakao") return false;
    const identitySubject = identity.identity_data?.sub;
    return identity.id === subject || identitySubject === subject;
  }) === true;
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) {
    return jsonResponse(request.url, { error: "forbidden" }, 403, null, false);
  }

  const rawFlowId = new URL(request.url).searchParams.get("flow");
  const flowId = normalizeKakaoFlowId(rawFlowId);
  if (rawFlowId !== null && !flowId) {
    return jsonResponse(request.url, { error: "expired" }, 401, null, false);
  }
  const accessTokenCookieName = getKakaoFlowCookieName(
    KAKAO_ACCESS_TOKEN_COOKIE,
    flowId,
  );
  const respond = (
    body: Record<string, unknown>,
    status: number,
    clearAccessToken = true,
  ) =>
    jsonResponse(
      request.url,
      body,
      status,
      accessTokenCookieName,
      clearAccessToken,
    );
  const accessToken = readCookie(request, accessTokenCookieName);
  const supabaseAccessToken = readBearerToken(request);
  if (!accessToken || !supabaseAccessToken) {
    return respond({ error: "expired" }, 401);
  }

  try {
    const { verifier, admin } = createSupabaseServerClients();
    const [{ data: userData, error: userError }, userInfoResponse] =
      await Promise.all([
        verifier.auth.getUser(supabaseAccessToken),
        fetch(KAKAO_USERINFO_ENDPOINT, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        }),
      ]);

    const userInfo = (await userInfoResponse.json()) as KakaoUserInfo;
    const subject = normalizeString(userInfo.sub, 128);
    if (
      userError ||
      !userData.user ||
      !userInfoResponse.ok ||
      !subject ||
      !userHasKakaoSubject(userData.user, subject)
    ) {
      return respond({ error: "identity_mismatch" }, 403);
    }

    const fullName = normalizeString(userInfo.name, 80);
    const gender = normalizeGender(userInfo.gender);
    const birthYear = normalizeBirthYear(userInfo.birthdate);
    const consentItems = [
      fullName ? "name" : null,
      gender ? "gender" : null,
      birthYear ? "birthyear" : null,
    ].filter((item): item is string => item !== null);
    const profileComplete = Boolean(fullName && gender && birthYear);
    const syncedAt = new Date().toISOString();

    const roleClient = admin as unknown as SupabaseClient;
    const [
      { error: profileError },
      { data: requirements, error: requirementError },
      { error: accessRoleError },
    ] = await Promise.all([
      admin.from("kakao_member_profiles").upsert(
        {
          member_id: userData.user.id,
          kakao_subject: subject,
          full_name: fullName,
          gender,
          birth_year: birthYear,
          profile_complete: profileComplete,
          consent_items: consentItems,
          last_synced_at: syncedAt,
        },
        { onConflict: "member_id" },
      ),
        admin
          .from("kakao_profile_requirements")
          .select("enforce_verified_profile")
          .eq("singleton", true)
          .maybeSingle(),
      roleClient.from("account_access_roles").upsert(
        {
          user_id: userData.user.id,
          role_code: "member",
          reports_to_operator_id: null,
        },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
    ]);

    if (profileError) {
      const duplicateIdentity = profileError.code === "23505";
      return respond(
        { error: duplicateIdentity ? "duplicate_identity" : "profile_sync" },
        duplicateIdentity ? 409 : 500,
      );
    }

    if (requirementError || accessRoleError) {
      return respond({ error: "profile_sync" }, 500);
    }

    if (requirements?.enforce_verified_profile && !profileComplete) {
      return respond(
        { error: "required_profile_incomplete", consentItems },
        422,
      );
    }

    return respond({
      profileComplete,
      consentItems,
    }, 200);
  } catch {
    return respond({ error: "profile_sync" }, 500);
  }
}

export async function GET() {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}
