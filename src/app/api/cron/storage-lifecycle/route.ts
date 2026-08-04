import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.NODE_ENV === "production" && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 30일 경과 및 90일 만료 대상 정리 (Supabase & R2 멀티 클라우드 핑퐁 롤오버 정책에 따른 생명주기 관리)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: expiredRecords, error: expiredError } = await supabase
      .from("multi_provider_records")
      .select("id")
      .or(`expires_at.lt.${new Date().toISOString()},created_at.lt.${ninetyDaysAgo}`)
      .limit(100);

    if (expiredError) {
      throw new Error(`Failed to fetch expired records: ${expiredError.message}`);
    }

    const expiredIds = (expiredRecords || []).map((r) => r.id);
    let deletedCount = 0;
    if (expiredIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("multi_provider_records")
        .delete()
        .in("id", expiredIds);

      if (!deleteError) {
        deletedCount = expiredIds.length;
      }
    }

    return NextResponse.json({
      success: true,
      deletedExpired: deletedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
