import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";

function removed() {
  return commerceJson({
    error: "center_topology_removed",
    message: "센터·매장 경로 설정 기능은 종료되었습니다.",
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
