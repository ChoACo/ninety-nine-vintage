import {
  authenticateCommerceRequest,
  commerceJson,
} from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateCommerceRequest(request, true);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.user.rpc(
    "queue_test_web_push_notification",
  );
  if (error) {
    return commerceJson(
      {
        error: "test_push_failed",
        message: "시험 알림을 전송 대기열에 넣지 못했습니다.",
      },
      error.code === "42501" ? 403 : 503,
    );
  }
  const result = data as {
    notificationId?: string;
    queued?: boolean;
    retryAfterSeconds?: number;
  } | null;
  if (!result?.queued) {
    return commerceJson(
      {
        error: "test_push_rate_limited",
        message: `${result?.retryAfterSeconds ?? 30}초 후 다시 시험해 주세요.`,
      },
      429,
    );
  }
  return commerceJson({ queued: true, notificationId: result.notificationId }, 202);
}
