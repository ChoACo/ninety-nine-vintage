import { LoginPrompt } from "@/components/features/account/LoginPrompt";
import { ModalShell } from "@/components/layout/ModalShell";

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = typeof value === "string" ? value : "/account";
  return candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.startsWith("/api") ? candidate : "/account";
}

export default async function InterceptedLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  return <ModalShell label="로그인"><LoginPrompt returnTo={safeReturnTo(query.next)} /></ModalShell>;
}
