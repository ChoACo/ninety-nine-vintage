import "server-only";

import { NextResponse } from "next/server";
import { createSupabaseServerClients } from "@/lib/supabase/server";

function kstDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { admin } = createSupabaseServerClients();
  const { data, error } = await admin.rpc("create_owner_settlement_batches", { p_settlement_date: kstDate() });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ success: true, result: data });
}
