"use client";

import { useEffect, useState } from "react";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

type Store = {
  id:string; name:string; planCode:string; requestedPlanCode:string|null; subscriptionStatus:string;
  monthlyFee:number; aiUsed:number; productsCreated:number;
  payoutAccount:{bankName:string;accountHolder:string;accountNumberMasked:string;status:string}|null;
  settlements:Array<{id:string;settlementDate:string;grossAmount:number;commissionAmount:number;subscriptionDeduction:number;payoutAmount:number;status:string}>;
};

export function OperatorPlatformConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [stores,setStores]=useState<Store[]>([]); const [message,setMessage]=useState("");
  const [bank,setBank]=useState(""); const [holder,setHolder]=useState(""); const [account,setAccount]=useState("");
  async function load(){if(!token){setMessage("로그인 세션을 확인해 주세요.");return;}const response=await fetch('/api/admin/operator/platform',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});const payload=await response.json();if(response.ok)setStores(payload.management?.stores??[]);else setMessage(payload.error??'조회 실패');}
  useEffect(()=>{
    if(!token)return;
    let active=true;
    void fetch('/api/admin/operator/platform',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'})
      .then(response=>response.json().then(payload=>({ok:response.ok,payload})))
      .then(({ok,payload})=>{if(!active)return;if(ok)setStores(payload.management?.stores??[]);else setMessage(payload.error??'조회 실패');})
      .catch(()=>{if(active)setMessage('조회 실패');});
    return()=>{active=false;};
  },[token]);
  async function action(body:Record<string,unknown>){if(!token){setMessage("로그인 세션을 확인해 주세요.");return;}setMessage('처리 중…');const response=await fetch('/api/admin/operator/platform',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});const payload=await response.json();setMessage(response.ok?'저장했습니다.':payload.error??'처리 실패');if(response.ok)void load();}
  return <div className="space-y-6"><header><h1 className="text-2xl font-black">센터 등급·정산</h1><p className="mt-2 text-sm text-muted">센터마다 한도, 이용료, 정산계좌와 판매금 정산을 독립 관리합니다.</p></header>{message?<p className="border border-line p-3 text-xs">{message}</p>:null}{stores.map(store=><section className="border border-line bg-surface p-5" key={store.id}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">{store.name}</h2><p className="text-xs text-muted">{store.planCode} · AI {store.aiUsed}회 · 상품 {store.productsCreated}개 · {store.subscriptionStatus}</p></div><div className="flex gap-2"><button className="border border-line px-3 py-2 text-xs" onClick={()=>void action({action:'request_plan',storeId:store.id,planCode:'standard'})}>3만원 등급 신청</button><button className="border border-line px-3 py-2 text-xs" onClick={()=>void action({action:'request_plan',storeId:store.id,planCode:'pro'})}>5만원 등급 신청</button></div></div><div className="mt-5 grid gap-2 sm:grid-cols-4"><input className="border border-line bg-paper p-2 text-xs" onChange={e=>setBank(e.target.value)} placeholder="은행명" value={bank}/><input className="border border-line bg-paper p-2 text-xs" onChange={e=>setHolder(e.target.value)} placeholder="예금주" value={holder}/><input className="border border-line bg-paper p-2 text-xs" onChange={e=>setAccount(e.target.value)} placeholder="계좌번호" value={account}/><button className="bg-ink p-2 text-xs font-bold text-paper" onClick={()=>void action({action:'submit_payout_account',storeId:store.id,bankName:bank,accountHolder:holder,accountNumber:account})}>정산계좌 제출</button></div>{store.payoutAccount?<p className="mt-2 text-xs text-muted">{store.payoutAccount.bankName} {store.payoutAccount.accountNumberMasked} · {store.payoutAccount.status}</p>:null}<div className="mt-5 space-y-2"><h3 className="text-xs font-black">정산 내역</h3>{store.settlements.length?store.settlements.map(batch=><div className="flex justify-between border-t border-line pt-2 text-xs" key={batch.id}><span>{batch.settlementDate} · {batch.status}</span><strong>{batch.payoutAmount.toLocaleString('ko-KR')}원</strong></div>):<p className="text-xs text-muted">아직 정산 내역이 없습니다.</p>}</div></section>)}</div>;
}
