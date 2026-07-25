import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

interface ExperiencePreferenceRow {
  simple_mode_enabled: boolean;
}

function mapPreferences(row: ExperiencePreferenceRow | null) {
  return {
    simpleModeEnabled: row?.simple_mode_enabled === true,
  };
}

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.user
    .from("member_experience_preferences")
    .select("simple_mode_enabled")
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    return commerceJson(
      {
        error: "experience_preferences_unavailable",
        message: "간편모드 설정을 불러오지 못했습니다.",
      },
      503,
    );
  }
  return commerceJson({
    preferences: mapPreferences(data as ExperiencePreferenceRow | null),
  });
}

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as
    | { simpleModeEnabled?: unknown }
    | null;
  if (typeof body?.simpleModeEnabled !== "boolean") {
    return commerceJson(
      {
        error: "invalid_experience_preferences",
        message: "간편모드 설정을 다시 확인해 주세요.",
      },
      400,
    );
  }

  const { data, error } = await auth.user
    .from("member_experience_preferences")
    .upsert(
      {
        user_id: auth.userId,
        simple_mode_enabled: body.simpleModeEnabled,
      },
      { onConflict: "user_id" },
    )
    .select("simple_mode_enabled")
    .single();
  if (error) {
    return commerceJson(
      {
        error: "experience_preferences_save_failed",
        message: "간편모드 설정을 저장하지 못했습니다.",
      },
      503,
    );
  }
  return commerceJson({
    preferences: mapPreferences(data as ExperiencePreferenceRow),
  });
}
