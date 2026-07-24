import { timingSafeEqual } from "node:crypto";
import { commerceJson } from "@/lib/commerce/server";
import { dispatchPendingWebPushNotifications } from "@/lib/webPush/server";

function secretsMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const expected = process.env.WEB_PUSH_DISPATCH_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return commerceJson({ error: "unauthorized" }, 401);
  }

  try {
    return commerceJson(await dispatchPendingWebPushNotifications());
  } catch {
    return commerceJson({ error: "push_dispatch_failed" }, 503);
  }
}
