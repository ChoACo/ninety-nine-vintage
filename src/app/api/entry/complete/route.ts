import { NextRequest, NextResponse } from "next/server";
import { createEntryPass, getEntryGateCookieName, getEntryGateMaxAge } from "@/lib/entryGateCookie";
import { createSupabaseServerClients } from "@/lib/supabase/server";

const allowedConsent = new Set(["accepted", "declined", "unknown"]);

function normalizeTarget(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/home";
  try {
    const target = new URL(value, "https://ninetynine.invalid");
    if (target.origin !== "https://ninetynine.invalid" || target.pathname.startsWith("/api") || target.pathname.startsWith("/_next")) return "/home";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return "/home"; }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json() as { nextPath?: unknown; deviceType?: unknown; cacheConsent?: unknown };
    const target = normalizeTarget(body.nextPath);
    const deviceType = typeof body.deviceType === "string" && body.deviceType.length <= 32 ? body.deviceType : "unknown";
    const cacheConsent = allowedConsent.has(String(body.cacheConsent)) ? String(body.cacheConsent) : "unknown";
    const { admin } = createSupabaseServerClients();
    const { data, error } = await admin.from("site_status").select("status, message").eq("singleton", true).maybeSingle();
    if (error || !data) return NextResponse.json({ ok: false, error: "site-unavailable" }, { status: 503 });
    if (data.status === "maintenance" || data.status === "preparing") return NextResponse.json({ ok: false, error: data.message || data.status }, { status: 503 });
    const pass = await createEntryPass();
    if (!pass) return NextResponse.json({ ok: false, error: "entry-secret-unavailable" }, { status: 503 });
    const response = NextResponse.json({ ok: true, target, expiresAt: new Date(Date.now() + getEntryGateMaxAge() * 1000).toISOString() });
    response.cookies.set({ name: getEntryGateCookieName(), value: pass, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: getEntryGateMaxAge() });
    console.info(JSON.stringify({ event: "entry_complete", requestId, target, deviceType, cacheConsent, durationMs: Date.now() - startedAt }));
    return response;
  } catch {
    console.warn(JSON.stringify({ event: "entry_blocked", requestId, reason: "complete-failed", durationMs: Date.now() - startedAt }));
    return NextResponse.json({ ok: false, error: "entry-complete-failed" }, { status: 503 });
  }
}

