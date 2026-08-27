import {
  authenticateOperatorStoreRequest,
  commerceJson,
} from "@/lib/commerce/server";

export async function POST(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  return commerceJson(
    {
      error: "auction_recovery_route_retired",
      message:
        "구형 미결제 복구 기능은 종료되었습니다. 차순위 후보를 모두 처리한 뒤 무입찰 마감 상품에서 재등록·아카이브숍 이동·삭제를 선택해 주세요.",
    },
    410,
  );
}
