import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { admin } = createSupabaseServerClients();
  const { data, error } = await admin.rpc("settle_due_delivered_inventory_shipments", { p_limit: 100 });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "auto_settlement_unavailable" }, { status: 503 });
  }
  return NextResponse.json({ success: true, ...data });
}
