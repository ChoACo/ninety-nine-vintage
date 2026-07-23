import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import { createSupabaseServerClients } from "@/lib/supabase/server";
import { getManualTransferAccount } from "@/lib/manualTransferConfig";
import { beginManualBankTransfer } from "@/services/manualPayments";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim();
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

export async function POST(request: Request) {
  if (!hasTrustedRequestOrigin(request)) return json({ error: "forbidden" }, 403);
  const token = bearerToken(request);
  if (!token) return json({ error: "unauthorized" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    const { verifier, admin } = createSupabaseServerClients();
    await getManualTransferAccount(admin);
    if (body?.action === "begin" && typeof body.productId === "string") {
      const { data: authData, error: authError } = await verifier.auth.getUser(token);
      if (authError || !authData.user) return json({ error: "unauthorized" }, 401);
      const transfer = await beginManualBankTransfer(token, body.productId);
      const [deadlineResult, roleResult] = await Promise.all([
        admin
          .from("manual_transfer_orders")
          .select("display_due_at, due_at")
          .eq("id", transfer.orderId)
          .maybeSingle(),
        admin
          .from("account_access_roles")
          .select("role_code")
          .eq("user_id", authData.user.id)
          .maybeSingle(),
      ]);
      if (deadlineResult.error || roleResult.error) {
        return json({ error: "manual_transfer_deadline_unavailable" }, 503);
      }
      const deadline = deadlineResult.data as unknown as {
        display_due_at: string | null;
        due_at: string | null;
      } | null;
      const dueAt = deadline?.display_due_at ?? deadline?.due_at ?? null;
      const deadlineEnforcementExempt =
        roleResult.data?.role_code === "band_member";
      return json({
        transfer: {
          ...transfer,
          dueAt,
          timedOut: Boolean(
            dueAt && Date.parse(dueAt) <= Date.now() && transfer.status !== "confirmed",
          ),
          deadlineEnforcementExempt,
        },
      });
    }
    if (body?.action === "confirm") {
      return json({ error: "manual_transfer_ledger_required" }, 409);
    }
    return json({ error: "invalid_request" }, 400);
  } catch {
    return json({ error: "manual_transfer_failed" }, 409);
  }
}

export async function GET() {
  return json({ error: "method_not_allowed" }, 405);
}
