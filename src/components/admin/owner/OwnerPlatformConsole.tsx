"use client";

import { RefreshCw, Save, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface StoreItem {
  aiUsed: number;
  id: string;
  name: string;
  operatorId: string;
  planCode: string;
  productsCreated: number;
  subscriptionStatus: string;
  subscriptionVersion: number;
  payoutAccount: { bankName:string; accountHolder:string; accountNumberMasked:string; status:string; version:number } | null;
  settlements: Array<{ id:string; settlementDate:string; payoutAmount:number; status:string; version:number }>;
}
interface GroupItem {
  id: string;
  name: string;
  representativeStoreId: string | null;
  shippingChargeMode: "per_store" | "per_group";
  shippingFeeAmount: number | null;
  storeIds: string[];
  version: number;
}
interface Management { stores: StoreItem[]; groups: GroupItem[]; }

const emptyManagement: Management = { stores: [], groups: [] };

export function OwnerPlatformConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [management, setManagement] = useState<Management>(emptyManagement);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [name, setName] = useState("");
  const [storeIds, setStoreIds] = useState<string[]>([]);
  const [mode, setMode] = useState<"per_store" | "per_group">("per_store");
  const [fee, setFee] = useState("4000");
  const [representativeStoreId, setRepresentativeStoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [settlementDate, setSettlementDate] = useState("");

  const load = useCallback(async (accessToken: string) => {
    const response = await fetch("/api/admin/owner/platform", {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store",
    });
    const payload = await response.json() as { management?: Management; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "플랫폼 설정을 불러오지 못했습니다.");
    setManagement(payload.management ?? emptyManagement);
  }, []);

  useEffect(() => {
    void getSupabaseBrowserClient().auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token ?? null;
      setToken(accessToken);
      if (accessToken) return load(accessToken);
    }).catch(() => setNotice("로그인 세션을 확인하지 못했습니다."));
  }, [load]);

  const selectedGroup = useMemo(
    () => management.groups.find((group) => group.id === selectedGroupId) ?? null,
    [management.groups, selectedGroupId],
  );

  const selectGroup = (group: GroupItem | null) => {
    setSelectedGroupId(group?.id ?? "");
    setName(group?.name ?? "");
    setStoreIds(group?.storeIds ?? []);
    setMode(group?.shippingChargeMode ?? "per_store");
    setFee(String(group?.shippingFeeAmount ?? 4000));
    setRepresentativeStoreId(group?.representativeStoreId ?? "");
  };

  const save = async () => {
    if (!token || !name.trim() || storeIds.length === 0) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/owner/platform", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_group", groupId: selectedGroup?.id ?? null,
          expectedVersion: selectedGroup?.version ?? null, name: name.trim(), storeIds,
          shippingChargeMode: mode,
          shippingFeeAmount: mode === "per_group" ? Number(fee) : null,
          representativeStoreId: mode === "per_group" ? representativeStoreId : null,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "출고 그룹을 저장하지 못했습니다.");
      await load(token); selectGroup(null);
      setNotice("출고 그룹과 배송비 청구 방식을 저장했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "출고 그룹을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  const runAction = async (body: Record<string, unknown>) => {
    if (!token) return;
    setBusy(true); setNotice("");
    try {
      const response=await fetch("/api/admin/owner/platform",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      const payload=await response.json() as {error?:string};
      if(!response.ok) throw new Error(payload.error??"처리하지 못했습니다.");
      await load(token); setNotice("소유자 작업을 반영했습니다."); return payload as {result?:{accountNumber?:string;bankName?:string;accountHolder?:string}};
    } catch(error){setNotice(error instanceof Error?error.message:"처리하지 못했습니다.");}
    finally{setBusy(false);}
  };

  const revealPayoutAccount=async(store:StoreItem)=>{
    const reason=window.prompt("정산계좌 원문 열람 사유를 입력하세요.","정산 송금");
    if(!reason)return;
    const payload=await runAction({action:"reveal_payout_account",storeId:store.id,reason});
    const account=payload?.result;
    if(account?.accountNumber)window.alert(`${account.bankName} ${account.accountNumber} (${account.accountHolder})`);
  };

  return <div className="space-y-6">
    <SectionHeading eyebrow="소유자 / 다중 센터" title="출고 그룹·회원제·정산 관리" description="센터 격리는 유지하면서 묶인 센터의 출고 협업과 구매자 배송비 청구 단위를 관리합니다." variant="page" action={<Button disabled={!token || busy} onClick={() => token && void load(token)} type="button"><RefreshCw size={14} /> 새로고침</Button>} />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    <section className="border border-line bg-paper p-4"><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-bold">월·목 정산일<input className="mt-1 block h-10 border border-line px-3" onChange={e=>setSettlementDate(e.target.value)} type="date" value={settlementDate}/></label><Button disabled={busy||!settlementDate} onClick={()=>void runAction({action:"create_settlements",settlementDate})} type="button">정산명세 생성</Button></div></section>
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2">{management.stores.map((store) => <article className="border border-line bg-paper p-4" key={store.id}><p className="text-sm font-black">{store.name}</p><p className="mt-2 text-[11px] text-muted">등급 {store.planCode} · {store.subscriptionStatus}</p><p className="mt-1 text-[11px] text-muted">오늘 AI {store.aiUsed}회 · 상품 {store.productsCreated}개</p><div className="mt-3 flex gap-2"><button className="border border-line px-2 py-1 text-[11px]" onClick={()=>void runAction({action:"approve_plan",storeId:store.id,planCode:"standard",startAt:new Date().toISOString(),expectedVersion:store.subscriptionVersion})}>3만원 승인</button><button className="border border-line px-2 py-1 text-[11px]" onClick={()=>void runAction({action:"approve_plan",storeId:store.id,planCode:"pro",startAt:new Date().toISOString(),expectedVersion:store.subscriptionVersion})}>5만원 승인</button></div>{store.payoutAccount?<div className="mt-3 border-t border-line pt-3 text-[11px]"><p>{store.payoutAccount.bankName} {store.payoutAccount.accountNumberMasked} · {store.payoutAccount.status}</p>{store.payoutAccount.status==="pending"?<button className="mt-2 border border-line px-2 py-1" onClick={()=>void runAction({action:"approve_payout_account",storeId:store.id,approved:true,expectedVersion:store.payoutAccount?.version})}>정산계좌 승인</button>:null}{store.payoutAccount.status==="approved"?<button className="ml-2 mt-2 border border-line px-2 py-1" onClick={()=>void revealPayoutAccount(store)}>송금용 계좌 열람</button>:null}</div>:null}<div className="mt-3 space-y-2">{store.settlements.map(batch=><div className="border-t border-line pt-2 text-[11px]" key={batch.id}><span>{batch.settlementDate} · {batch.payoutAmount.toLocaleString("ko-KR")}원 · {batch.status}</span>{batch.status==="draft"?<button className="ml-2 underline" onClick={()=>{const reference=window.prompt("실제 송금 참조번호를 입력하세요.");if(reference)void runAction({action:"complete_settlement",batchId:batch.id,transferReference:reference,expectedVersion:batch.version});}}>송금완료</button>:null}</div>)}</div></article>)}</section>
    <section className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
      <div className="border border-line bg-paper p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-black">출고 그룹</h2><button className="text-xs underline" onClick={() => selectGroup(null)} type="button">새 그룹</button></div><div className="mt-3 space-y-2">{management.groups.map((group) => <button className={`w-full border p-3 text-left text-xs ${selectedGroupId === group.id ? "border-ink" : "border-line"}`} key={group.id} onClick={() => selectGroup(group)} type="button"><span className="font-black">{group.name}</span><span className="mt-1 block text-muted">{group.shippingChargeMode === "per_group" ? `그룹 배송비 ${group.shippingFeeAmount?.toLocaleString("ko-KR")}원` : "센터별 배송비"}</span></button>)}</div></div>
      <div className="space-y-4 border border-line bg-paper p-5"><div className="flex items-center gap-2"><Truck size={17} /><h2 className="text-sm font-black">{selectedGroup ? "출고 그룹 수정" : "출고 그룹 추가"}</h2></div><input className="h-11 w-full border border-line px-3 text-xs" onChange={(event) => setName(event.target.value)} placeholder="그룹 이름" value={name} /><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{management.stores.map((store) => <label className="flex items-center gap-2 border border-line p-3 text-xs" key={store.id}><input checked={storeIds.includes(store.id)} onChange={() => setStoreIds((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} type="checkbox" /> {store.name}</label>)}</div><select className="h-11 w-full border border-line px-3 text-xs" onChange={(event) => setMode(event.target.value as "per_store" | "per_group")} value={mode}><option value="per_store">센터마다 배송비 청구</option><option value="per_group">출고 그룹 전체 배송비 1건 청구</option></select>{mode === "per_group" && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><input className="h-11 border border-line px-3 text-xs" min="1" onChange={(event) => setFee(event.target.value)} placeholder="그룹 배송비" type="number" value={fee} /><select className="h-11 border border-line px-3 text-xs" onChange={(event) => setRepresentativeStoreId(event.target.value)} value={representativeStoreId}><option value="">대표 정산센터 선택</option>{management.stores.filter((store) => storeIds.includes(store.id)).map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div>}<Button disabled={busy || !name.trim() || storeIds.length === 0 || (mode === "per_group" && (!representativeStoreId || Number(fee) < 1))} onClick={() => void save()} type="button" variant="primary"><Save size={14} /> 저장</Button></div>
    </section>
  </div>;
}
