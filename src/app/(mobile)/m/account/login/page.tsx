import type { Metadata } from "next";
import { LoginPrompt } from "@/components/features/account/LoginPrompt";

export const metadata: Metadata = { title: "로그인", robots: { follow: false, index: false } };

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = typeof value === "string" ? value : "/m/account";
  return candidate.startsWith("/m/") && !candidate.startsWith("//") && !candidate.startsWith("/api") ? candidate : "/m/account";
}

export default async function MobileLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  return <div className="grid min-h-[60svh] place-items-center"><LoginPrompt returnTo={safeReturnTo(query.next)} /></div>;
}
