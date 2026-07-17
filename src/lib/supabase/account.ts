import { getSupabaseBrowserClient } from "./client";

export async function deleteMyAccount(): Promise<void> {
  const client = getSupabaseBrowserClient();
  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError || !data.session) {
    throw new Error("로그인 정보를 확인하지 못했습니다.");
  }

  const response = await fetch("/api/account/delete", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("회원 탈퇴를 완료하지 못했습니다.");
  await client.auth.signOut({ scope: "local" });
}
