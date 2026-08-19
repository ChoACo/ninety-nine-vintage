import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { disableWebPush } from "@/lib/webPush/client";

export async function logoutBrowserSession(
  accessToken: string,
  basePath: "" | "/m" = "",
) {
  const client = getSupabaseBrowserClient();
  await disableWebPush(accessToken);
  await Promise.race([
    Promise.allSettled([
      client.auth.signOut(),
      fetch("/api/auth/kakao/logout", { method: "POST", credentials: "include" }),
    ]),
    new Promise((resolve) => window.setTimeout(resolve, 2_000)),
  ]);
  window.location.assign(`${basePath}/home`);
}
