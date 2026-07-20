import { getSupabaseBrowserClient } from "./client";

export interface KakaoMemberProfile {
  memberId: string;
  fullName: string | null;
  gender: "female" | "male" | null;
  birthYear: number | null;
  profileComplete: boolean;
  consentItems: string[];
  lastSyncedAt: string;
}

export async function fetchMyKakaoProfile(
  memberId: string,
): Promise<KakaoMemberProfile | null> {
  const { data, error } = await getSupabaseBrowserClient()
    .from("kakao_member_profiles")
    .select(
      "member_id, full_name, gender, birth_year, profile_complete, consent_items, last_synced_at",
    )
    .eq("member_id", memberId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    memberId: data.member_id,
    fullName: data.full_name,
    gender:
      data.gender === "female" || data.gender === "male"
        ? data.gender
        : null,
    birthYear: data.birth_year,
    profileComplete: data.profile_complete,
    consentItems: data.consent_items,
    lastSyncedAt: data.last_synced_at,
  };
}
