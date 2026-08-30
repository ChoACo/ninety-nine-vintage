import "server-only";

import { NextResponse } from "next/server";
import { notifyIndexNow, productPublicUrl } from "@/lib/seo/indexNow.server";
import { PUBLIC_SITE_ORIGIN } from "@/lib/seo/productSeo";
import { createSupabaseServerClients } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { admin } = createSupabaseServerClients();
  const cutoff = new Date(Date.now() - 30 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await admin
    .from("products")
    .select("id,sale_type")
    .eq("status", "active")
    .gte("updated_at", cutoff)
    .lte("publish_at", new Date().toISOString())
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) {
    return NextResponse.json({ error: "seo_product_sync_unavailable" }, { status: 503 });
  }

  const urls = [
    `${PUBLIC_SITE_ORIGIN}/sitemap.xml`,
    `${PUBLIC_SITE_ORIGIN}/home`,
    `${PUBLIC_SITE_ORIGIN}/shop`,
    `${PUBLIC_SITE_ORIGIN}/feed`,
    ...(data ?? []).map((product) => productPublicUrl(product.id, product.sale_type)),
  ];
  const batches = Array.from({ length: Math.ceil(urls.length / 100) }, (_, index) =>
    urls.slice(index * 100, index * 100 + 100)
  );
  const results = await Promise.all(batches.map((batch) => notifyIndexNow(batch)));
  const success = results.every(Boolean);
  return NextResponse.json({ success, notified: urls.length }, { status: success ? 200 : 503 });
}
