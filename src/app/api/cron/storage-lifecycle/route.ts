import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupExpiredStorageRecords,
  type ExpiredStorageRecord,
} from "@/lib/multicloud/cleanup";
import { getConfiguredStorageAdapters } from "@/lib/multicloud/factory";

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
    // Expired locator rows are scanned in bounded batches. Physical objects must
    // be deleted before their locator so failures remain observable and retryable.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data: expiredRecords, error: expiredError } = await supabase
      .from("multi_provider_records")
      .select("id,storage_provider_id,storage_key")
      .or(`expires_at.lt.${new Date().toISOString()},created_at.lt.${ninetyDaysAgo}`)
      .limit(100);

    if (expiredError) {
      throw new Error(`Failed to fetch expired records: ${expiredError.message}`);
    }

    const records = (expiredRecords ?? []) as ExpiredStorageRecord[];
    const adapters = getConfiguredStorageAdapters(supabase);
    const report = await cleanupExpiredStorageRecords(
      records,
      adapters,
      async (id) => {
        const { error: deleteError } = await supabase
        .from("multi_provider_records")
        .delete()
        .eq("id", id);
        if (deleteError) throw new Error(`locator_delete_failed: ${deleteError.message}`);
      },
    );

    return NextResponse.json({
      success: report.failed.length === 0,
      scannedExpired: report.scanned,
      deletedExpired: report.deleted,
      failures: report.failed,
      timestamp: new Date().toISOString(),
    }, { status: report.failed.length === 0 ? 200 : 503 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
