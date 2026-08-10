"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { invalidateOwnerPlatform, loadOwnerPlatform } from "./ownerPlatformData";

interface StorePlan {
  id: string;
  name: string;
  planCode: string;
  subscriptionStatus: string;
  subscriptionVersion: number;
}

export function OwnerPlanApprovalPanel() {
  const [token, setToken] = useState<string | null>(null);
  const [stores, setStores] = useState<StorePlan[]>([]);
  const [notice, setNotice] = useState("");

  const load = async (accessToken: string) => {
    const payload = await loadOwnerPlatform(accessToken);
    setStores((payload.management?.stores ?? []) as StorePlan[]);
  };

  useEffect(() => {
    void getSupabaseBrowserClient().auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token ?? null;
      setToken(accessToken);
      if (accessToken) void load(accessToken).catch((error) => setNotice(error.message));
    });
  }, []);

  const run = async (body: Record<string, unknown>) => {
    if (!token) return;
    const response = await fetch("/api/admin/owner/platform", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    setNotice(response.ok ? "요금제 결정을 기록했습니다." : payload.error ?? "처리하지 못했습니다.");
    if (response.ok) {
      invalidateOwnerPlatform(token);
      await load(token);
    }
  };

  const pending = stores.filter((store) => store.subscriptionStatus === "pending_approval");
  return (
    <section className="mb-6 border border-line bg-paper p-4">
      <h2 className="text-sm font-black">요금제·자동화 승인</h2>
      <p className="mt-2 text-[11px] text-muted">승인·거절·변경은 적용일과 다음 청구일을 포함해 감사 기록에 남습니다.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {pending.map((store) => (
          <article className="border border-line p-3 text-xs" key={store.id}>
            <strong>{store.name}</strong>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="border border-ink px-2 py-1" onClick={() => void run({ action: "approve_plan", storeId: store.id, planCode: "pro", startAt: new Date().toISOString(), expectedVersion: store.subscriptionVersion })} type="button">프리미엄 승인</button>
              <button className="border border-rose-300 px-2 py-1 text-rose-700" onClick={() => { const reason = window.prompt("거절 사유를 입력하세요."); if (reason) void run({ action: "reject_plan", storeId: store.id, reason, expectedVersion: store.subscriptionVersion }); }} type="button">거절</button>
            </div>
          </article>
        ))}
        {pending.length === 0 && <p className="text-xs text-muted">대기 중인 요금제 신청이 없습니다.</p>}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <p className="text-xs font-black">프리미엄 자동화 프로그램</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {stores.filter((store) => store.planCode === "pro" && store.subscriptionStatus === "active").map((store) => (
            <button className="border border-line px-3 py-2 text-xs" key={store.id} onClick={() => { const clientId = window.prompt("자동화 클라이언트 ID를 입력하세요."); const version = clientId ? window.prompt("자동화 프로그램 버전을 입력하세요.") : null; if (clientId && version) void run({ action: "configure_automation", storeId: store.id, enabled: true, clientId, version, expectedVersion: store.subscriptionVersion }); }} type="button">{store.name} 자동화 연결</button>
          ))}
        </div>
      </div>
      {notice && <p className="mt-3 text-xs">{notice}</p>}
    </section>
  );
}
