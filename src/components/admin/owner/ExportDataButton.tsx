"use client";

import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOwnerScopeStore } from "@/store/useOwnerScopeStore";

type ExportRow={orderNumber:string;paidAt:string;storeName:string;productName:string;saleAmount:number;platformFee:number;pgFee:number;netPayout:number;paymentMethod:string;status:string};
const headers=["주문번호","결제일시","판매센터명","상품명","최종낙찰가/판매가","플랫폼수수료","PG수수료","실정산지급액","결제수단","상태"];
const cell=(value:unknown)=>`"${String(value??"").replaceAll('"','""')}"`;

export function ExportDataButton(){
  const selectedStoreId=useOwnerScopeStore(state=>state.selectedStoreId); const [busy,setBusy]=useState(false); const [notice,setNotice]=useState("");
  const download=async()=>{setBusy(true);setNotice("");try{const session=(await getSupabaseBrowserClient().auth.getSession()).data.session;if(!session)throw new Error("로그인이 필요합니다.");const query=selectedStoreId?`?storeId=${encodeURIComponent(selectedStoreId)}`:"";const response=await fetch(`/api/admin/owner/settlement-export${query}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});const payload=await response.json() as {rows?:ExportRow[];message?:string};if(!response.ok)throw new Error(payload.message??"정산 자료를 불러오지 못했습니다.");const rows=payload.rows??[];const lines=[headers.map(cell).join(","),...rows.map(row=>[row.orderNumber,new Date(row.paidAt).toLocaleString("ko-KR"),row.storeName,row.productName,row.saleAmount,row.platformFee,row.pgFee,row.netPayout,row.paymentMethod,row.status].map(cell).join(","))];const blob=new Blob([`\uFEFF${lines.join("\r\n")}`],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`ninety-nine-settlements-${new Date().toISOString().slice(0,10)}.csv`;anchor.click();URL.revokeObjectURL(url);setNotice(`${rows.length}건을 엑셀용 CSV로 내보냈습니다.`);}catch(error){setNotice(error instanceof Error?error.message:"내보내기에 실패했습니다.");}finally{setBusy(false);}};
  return <div><button className="inline-flex min-h-11 items-center gap-2 border border-line bg-paper px-4 text-xs font-black disabled:opacity-40" disabled={busy} onClick={()=>void download()} type="button">{busy?<LoaderCircle className="animate-spin" size={14}/>:<Download size={14}/>} 엑셀 내보내기</button>{notice&&<p aria-live="polite" className="mt-2 text-[11px] text-muted">{notice}</p>}</div>;
}
