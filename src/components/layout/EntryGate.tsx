"use client";

import { Check, Circle, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readCacheConsent } from "@/lib/cacheConsent";
import { ENTRY_READONLY_KEY } from "@/lib/entryMode";
import { ENTRY_GATE_ENABLED } from "@/lib/featureFlags";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const CACHE_KEY = "ninetynine-entry-cache";
const SESSION_KEY = "ninetynine-entry-gate-v1";
const DEPLOY_VERSION = process.env.NEXT_PUBLIC_DEPLOY_VERSION?.trim() || "v1";
const phases = ["DEVICE", "SESSION", "SITE", "CACHE"] as const;
type Phase = (typeof phases)[number];
type SiteStatus = "operational" | "maintenance" | "preparing";
type GateResult = "checking" | "ready" | "blocked";

interface EntryCache { version: string; checkedAt: string; deviceType: string; }
interface SiteResponse { status?: SiteStatus; message?: string; dbConnected?: boolean; }

function detectDeviceType() {
  if (window.matchMedia("(max-width: 479px)").matches) return "small-mobile";
  if (window.matchMedia("(max-width: 767px)").matches) return "mobile";
  if (window.matchMedia("(max-width: 1023px)").matches) return "tablet-fold";
  return "desktop";
}
function readEntryCache(): EntryCache | null {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null") as Partial<EntryCache> | null;
    if (!parsed?.version || !parsed.checkedAt || !parsed.deviceType) return null;
    return { version: parsed.version, checkedAt: parsed.checkedAt, deviceType: parsed.deviceType };
  } catch { return null; }
}

function readNextPath() {
  const candidate = new URLSearchParams(window.location.search).get("next") || "/home";
  try {
    const target = new URL(candidate, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname.startsWith("/api") || target.pathname.startsWith("/_next") || target.pathname.startsWith("//")) return "/home";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch { return "/home"; }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), timeoutMs))]);
}

async function completeEntry(nextPath: string, deviceType: string) {
  const response = await fetch("/api/entry/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nextPath, deviceType, cacheConsent: readCacheConsent() }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("entry-complete-failed");
}

export function EntryGate() {
  if (!ENTRY_GATE_ENABLED) return null;
  return <EnabledEntryGate />;
}

function EnabledEntryGate() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("DEVICE");
  const [result, setResult] = useState<GateResult>("checking");
  const [detail, setDetail] = useState("기기 환경을 확인하고 있습니다.");
  const [siteMessage, setSiteMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const startedAt = Date.now();
      const nextPath = readNextPath();
      const deviceType = detectDeviceType();
      setDetail(`${deviceType} 화면을 준비하고 있습니다.`);
      setPhase("SESSION");

      const sessionCheck = withTimeout((async () => {
        try {
          const client = getSupabaseBrowserClient();
          await withTimeout(client.auth.getSession(), 1500);
        } catch {
          // Guests and unavailable auth services can still browse the public catalog.
        }
      })(), 1500);
      const siteCheck = withTimeout(fetch("/api/site/status", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as SiteResponse;
        if (!response.ok || payload.dbConnected === false) throw new Error("site-unavailable");
        return payload;
      }), 1500);
      const cacheCheck = Promise.resolve(readEntryCache());

      await Promise.allSettled([sessionCheck, siteCheck, cacheCheck]);
      if (cancelled) return;
      setPhase("SITE");
      const site = await siteCheck.catch(() => null);
      const previousCache = await cacheCheck;
      if (site?.status === "maintenance" || site?.status === "preparing") {
        setSiteMessage(site.message || (site.status === "maintenance" ? "현재 점검 중입니다." : "서비스를 준비 중입니다."));
        setResult("blocked");
        return;
      }
      if (!site?.status) {
        setSiteMessage("사이트 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        setResult("blocked");
        return;
      }
      setDetail(previousCache?.version === DEPLOY_VERSION ? "최근 진입 기록을 확인하고 있습니다." : "서비스 상태를 확인했습니다.");
      setPhase("CACHE");
      const elapsed = Date.now() - startedAt;
      try {
        await completeEntry(nextPath, deviceType);
      } catch {
        setSiteMessage("진입 확인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        setResult("blocked");
        return;
      }
      const entry: EntryCache = { version: DEPLOY_VERSION, checkedAt: new Date().toISOString(), deviceType };
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry)); } catch { /* private browsing */ }
      try { sessionStorage.removeItem(ENTRY_READONLY_KEY); } catch { /* private browsing */ }
      setResult("ready");
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ version: DEPLOY_VERSION, completedAt: new Date().toISOString() })); } catch { /* private browsing */ }
      if (elapsed < 250) await new Promise((resolve) => window.setTimeout(resolve, 250 - elapsed));
      if (!cancelled) router.replace(nextPath);
    };

    let completed = false;
    try {
      const previous = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null") as { version?: string } | null;
      completed = previous?.version === DEPLOY_VERSION;
    } catch { /* private browsing */ }
    if (completed) {
      const nextPath = readNextPath();
      void completeEntry(nextPath, "cached").then(() => router.replace(nextPath)).catch(() => void run());
    } else void run();
    return () => { cancelled = true; };
  }, [router]);

  const retry = () => window.location.reload();
  return <main className="fixed inset-0 z-[100] grid min-h-screen place-items-center overflow-y-auto bg-ink px-5 py-10 text-paper"><div className="w-full max-w-md"><div className="flex items-center justify-between border-b border-white/20 pb-5"><p className="text-sm font-black tracking-[-.06em]">NINETY-NINE VINTAGE</p><span className="eyebrow text-zinc-500">ENTRY / {DEPLOY_VERSION}</span></div><div className="py-20"><p className="eyebrow text-zinc-500">WELCOME TO THE ARCHIVE</p><h1 className="mt-5 text-[clamp(3rem,14vw,6rem)] font-black leading-[.86] tracking-[-.1em]">시간을<br />다시 입는<br /><span className="text-zinc-500">경험.</span></h1><p className="mt-8 max-w-xs text-sm leading-6 text-zinc-400">{siteMessage || detail}</p></div><ol className="grid gap-3 border-t border-white/20 pt-5" aria-label="진입 상태">{phases.map((item, index) => { const current = phases.indexOf(phase); const complete = result !== "checking" && result !== "blocked" || index < current; return <li className="flex items-center gap-3 text-xs" key={item}>{complete ? <Check size={15} className="text-emerald-300" /> : item === phase && result === "checking" ? <LoaderCircle className="animate-spin text-white" size={15} /> : <Circle size={15} className="text-zinc-600" />}<span className={item === phase ? "font-bold text-paper" : complete ? "text-zinc-300" : "text-zinc-600"}>{item}</span><span className="ml-auto text-[10px] text-zinc-500">{complete ? "READY" : item === phase && result === "checking" ? "CHECKING" : "WAITING"}</span></li>; })}</ol>{result === "blocked" && <div className="mt-8 border border-amber-200/40 bg-amber-100/10 p-4 text-sm text-amber-100"><p className="flex items-center gap-2 font-bold"><WifiOff size={15} /> 잠시만 기다려 주세요</p><p className="mt-2 text-xs leading-5 text-amber-100/70">점검이 끝난 뒤 다시 접속해 주세요.</p><button className="mt-4 inline-flex items-center gap-2 border border-white/30 px-4 py-2 text-xs font-bold" onClick={retry} type="button"><RefreshCw size={13} /> 다시 확인</button></div>}{result !== "blocked" && <p className="mt-8 text-[10px] text-zinc-600">공개 상품은 게스트로 둘러볼 수 있습니다.</p>}</div></main>;
}
