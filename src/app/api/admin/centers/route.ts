import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

function removed() {
  return commerceJson({
    error: "center_management_removed",
    message: "센터 관리 기능은 종료되었습니다. 매장 출고·보관 화면을 이용해 주세요.",
  }, 410);
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  return removed();
}

export async function POST(request: Request) {
  const auth = await authenticateStaffRequest(request, true);
  if (!auth.ok) return auth.response;
  return removed();
}
