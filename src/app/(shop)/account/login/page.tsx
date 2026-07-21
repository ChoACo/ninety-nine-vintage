import type { Metadata } from "next";
import { LoginPrompt } from "@/components/features/account/LoginPrompt";

export const metadata: Metadata = { title: "로그인 | NINETY-NINE VINTAGE", robots: { index: false, follow: false } };

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = typeof value === "string" ? value : "/account";
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/api") ? candidate : "/account";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  return <div className="grid min-h-[65vh] place-items-center"><LoginPrompt returnTo={safeReturnTo(query.next)} /></div>;
}
