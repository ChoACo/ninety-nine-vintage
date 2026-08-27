import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const provided = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  const { admin } = createSupabaseServerClients();
  const envAuthorized = Boolean(cronSecret) && provided === cronSecret;
  const vaultVerification = !envAuthorized && provided
    ? await admin.rpc("verify_web_push_dispatch_secret", { p_secret: provided })
    : { data: false, error: null };
  if (!envAuthorized && (vaultVerification.error || vaultVerification.data !== true)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await admin.rpc("settle_due_delivered_inventory_shipments", { p_limit: 100 });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "auto_settlement_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ success: true, ...data });
}
