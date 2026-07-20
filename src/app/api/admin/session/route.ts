import { authenticateCommerceRequest, commerceJson } from "@/lib/commerce/server";

export async function GET(request: Request) {
  const auth = await authenticateCommerceRequest(request);
  if (!auth.ok) return auth.response;
  const [{ data: profile, error: profileError }, { data: role, error: roleError }] = await Promise.all([
    auth.admin.from("profiles").select("id, display_name").eq("id", auth.userId).maybeSingle(),
    auth.admin.from("account_access_roles").select("role_code, grade_level, reports_to_operator_id").eq("user_id", auth.userId).maybeSingle(),
  ]);
  if (profileError || roleError) return commerceJson({ error: "session_unavailable" }, 503);
  const roleCode = role?.role_code ?? "member";
  const isOwner = roleCode === "owner";
  const isStaff = isOwner || roleCode === "operator" || roleCode === "employee" || roleCode === "band_member";
  const canAccessOperator = isOwner || roleCode === "operator" || roleCode === "employee";
  return commerceJson({
    session: {
      userId: auth.userId,
      displayName: profile?.display_name ?? "빈티지 피플",
      roleCode,
      gradeLevel: Number(role?.grade_level ?? 3),
      isStaff,
      isOwner,
      canAccessOperator,
      canAccessOwner: isOwner,
    },
  });
}
