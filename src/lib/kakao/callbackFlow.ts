interface OwnedSession {
  access_token: string;
  user: { id: string };
}

function isSameSession(
  current: OwnedSession | null,
  expected: OwnedSession,
): boolean {
  return (
    current?.user.id === expected.user.id &&
    current.access_token === expected.access_token
  );
}

export async function completeForOwnedKakaoSession<T>(input: {
  session: OwnedSession;
  complete: (accessToken: string) => Promise<T>;
  getCurrentSession: () => Promise<OwnedSession | null>;
  signOutCurrentSession: () => Promise<unknown>;
}): Promise<T> {
  try {
    const result = await input.complete(input.session.access_token);
    const current = await input.getCurrentSession();
    if (!isSameSession(current, input.session)) {
      throw new Error(
        "로그인 처리 중 계정이 변경되었습니다. 현재 계정으로 다시 로그인해 주세요.",
      );
    }
    return result;
  } catch (error) {
    try {
      const current = await input.getCurrentSession();
      if (isSameSession(current, input.session)) {
        await input.signOutCurrentSession();
      }
    } catch {
      // An unreadable or different session must never be signed out blindly.
    }
    throw error;
  }
}
