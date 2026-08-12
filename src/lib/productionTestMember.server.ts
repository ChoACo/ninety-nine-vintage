import "server-only";

import { isProductionTestMember, PRODUCTION_TEST_MEMBER_EMAIL } from "@/lib/productionTestMember";
import { createSupabasePublicClient } from "@/lib/supabase/server";

export interface ProductionTestMemberSession {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export async function signInProductionTestMember(
  password: string,
): Promise<ProductionTestMemberSession | null> {
  const client = createSupabasePublicClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: PRODUCTION_TEST_MEMBER_EMAIL,
    password,
  });
  if (
    error ||
    !data.session ||
    !isProductionTestMember(data.user)
  ) {
    return null;
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    userId: data.user.id,
  };
}
