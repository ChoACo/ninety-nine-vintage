import { authenticateOperatorStoreRequest, commerceJson } from "@/lib/commerce/server";

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function GET(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "operator") return commerceJson({ error: "forbidden" }, 403);
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const rpc = auth.user as unknown as RpcClient;
  const { data, error } = await rpc.rpc("get_operator_member_directory", { p_limit: limit, p_offset: offset });
  if (error) return commerceJson({ error: errorMessage(error, "하위 계정 목록을 불러오지 못했습니다.") }, 503);
  return commerceJson({ members: data ?? [], roleCode: auth.roleCode, limit, offset });
}

export async function PATCH(request: Request) {
  const auth = await authenticateOperatorStoreRequest(request, true);
  if (!auth.ok) return auth.response;
  return commerceJson({
    error: "operator_member_mutation_forbidden",
    message: "전역 역할·경고·제재는 소유자만 관리할 수 있습니다.",
  }, 403);
}
