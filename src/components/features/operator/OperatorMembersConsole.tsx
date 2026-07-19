"use client";

import { Edit3, RefreshCw, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Member {
  id: string;
  display_name: string;
  legal_name?: string | null;
  email?: string | null;
  phone?: string | null;
  account_status: string;
  shipping_credit_count: number;
  address_count: number;
  bid_count: number;
  support_status?: string | null;
  created_at: string;
  last_seen_at?: string | null;
  access_role?: string;
  warning_count?: number;
  sanction_count?: number;
  bid_blocked_until?: string | null;
  payment_deadline_exempt?: boolean;
}

function date(value?: string | null) { return value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "기록 없음"; }

export function OperatorMembersConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    const response = await fetch("/api/operator/members?limit=500", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json() as { members?: Member[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "회원 목록을 불러오지 못했습니다.");
    setMembers(payload.members ?? []);
  }, []);

  useEffect(() => {
    void (async () => {
      try { const session = (await getSupabaseBrowserClient().auth.getSession()).data.session; setToken(session?.access_token ?? null); if (session) await load(session.access_token); }
      catch (error) { setNotice(error instanceof Error ? error.message : "회원 목록을 불러오지 못했습니다."); }
    })();
  }, [load]);

  const visibleMembers = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return members.filter((member) => !query || [member.display_name, member.legal_name, member.email, member.phone, member.access_role].filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [filter, members]);

  const patchMember = async (body: Record<string, unknown>, message: string) => {
    if (!token || busy) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/operator/members", { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? message);
      setNotice(message); await load(token);
      if (selected) setSelected((members.find((member) => member.id === selected.id) ?? selected));
    } catch (error) { setNotice(error instanceof Error ? error.message : message); }
    finally { setBusy(false); }
  };

  const selectMember = (member: Member) => { setSelected(member); setEditName(member.display_name ?? ""); setEditPhone(member.phone ?? ""); };
  const adjustCredits = (member: Member, delta: number) => void patchMember({ memberId: member.id, action: "credits", delta }, "배송 이용권을 변경했습니다.");
  const changeStatus = (member: Member, status: string) => void patchMember({ memberId: member.id, action: "status", status }, "회원 상태를 변경했습니다.");
  const saveProfile = () => { if (selected) void patchMember({ memberId: selected.id, action: "profile", displayName: editName, phone: editPhone }, "회원 정보를 저장했습니다."); };
  const changeRole = (member: Member, roleCode: string) => void patchMember({ memberId: member.id, action: "role", roleCode }, "회원 등급을 변경했습니다.");

  return <div className="space-y-8">
    <div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">OPERATOR / MEMBER OPERATIONS</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">회원 관리</h1><p className="mt-3 text-sm text-muted">상담·주문·배송 이력을 확인하고 회원 상태와 배송 이용권을 관리합니다.</p></div><div className="text-right"><p className="font-mono text-3xl font-bold">{members.length}</p><p className="text-[10px] text-muted">KAKAO MEMBERS</p></div></div>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
    <div className="flex items-center gap-3"><div className="flex flex-1 items-center gap-2 border border-line bg-paper px-3"><Search size={14} className="text-muted" /><input aria-label="회원 검색" className="h-11 w-full bg-transparent text-xs outline-none" onChange={(event) => setFilter(event.target.value)} placeholder="이름·이메일·연락처·등급 검색" value={filter} /></div><button className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button></div>
    <div className="grid grid-cols-[1fr_360px] gap-8"><section className="overflow-x-auto border-y border-line"><table className="w-full min-w-[900px] text-left text-xs"><thead className="border-b border-line bg-surface text-[10px] uppercase tracking-[.12em] text-muted"><tr><th className="px-4 py-4">회원</th><th className="px-4 py-4">등급/상태</th><th className="px-4 py-4">배송 이용권</th><th className="px-4 py-4">활동</th><th className="px-4 py-4">최근 접속</th><th className="px-4 py-4" /></tr></thead><tbody className="divide-y divide-line">{visibleMembers.map((member) => <tr className={selected?.id === member.id ? "bg-surface" : ""} key={member.id}><td className="px-4 py-4"><p className="font-bold">{member.display_name || "이름 없음"}</p><p className="mt-1 text-[10px] text-muted">{member.email || "이메일 비공개"}</p></td><td className="px-4 py-4"><div className="flex items-center gap-2"><select aria-label={`${member.display_name} 등급`} className="border border-line bg-paper px-2 py-1 text-[10px]" disabled={busy} onChange={(event) => changeRole(member, event.target.value)} value={member.access_role ?? "member"}><option value="member">회원</option><option value="band_member">밴드 회원</option><option value="employee">직원</option><option value="operator">운영자</option></select><button aria-label={`${member.display_name} 상태 변경`} className={member.account_status === "active" ? "text-emerald-700 underline" : "text-red-700 underline"} disabled={busy} onClick={() => changeStatus(member, member.account_status === "active" ? "suspended" : "active")} type="button">{member.account_status === "active" ? "활성" : "정지"}</button></div></td><td className="px-4 py-4"><div className="flex items-center gap-2"><span className="font-mono font-bold">{member.shipping_credit_count}</span><button aria-label={`${member.display_name} 배송 이용권 추가`} className="border border-line px-2 py-1" disabled={busy} onClick={() => adjustCredits(member, 1)} type="button">+1</button><button aria-label={`${member.display_name} 배송 이용권 차감`} className="border border-line px-2 py-1" disabled={busy || member.shipping_credit_count < 1} onClick={() => adjustCredits(member, -1)} type="button">−1</button></div></td><td className="px-4 py-4 text-muted">주소 {member.address_count} · 입찰 {member.bid_count}<br />상담 {member.support_status ?? "없음"}</td><td className="px-4 py-4 text-muted">{date(member.last_seen_at)}</td><td className="px-4 py-4 text-right"><button className="inline-flex items-center gap-1 underline" onClick={() => selectMember(member)} type="button"><Edit3 size={13} /> 상세</button></td></tr>)}{visibleMembers.length === 0 && <tr><td className="px-4 py-16 text-center text-muted" colSpan={6}>조건에 맞는 회원이 없습니다.</td></tr>}</tbody></table></section><aside className="border border-line bg-surface p-6">{selected ? <><div className="flex items-center gap-3 border-b border-line pb-5"><span className="grid size-10 place-items-center rounded-full bg-ink text-paper"><UserRound size={16} /></span><div><p className="font-bold">{selected.display_name}</p><p className="mt-1 text-[10px] text-muted">가입 {date(selected.created_at)}</p></div></div><div className="mt-5 space-y-3 text-xs"><label className="block"><span className="mb-1 block text-[10px] text-muted">표시 이름</span><input className="w-full border border-line bg-paper px-3 py-2" onChange={(event) => setEditName(event.target.value)} value={editName} /></label><label className="block"><span className="mb-1 block text-[10px] text-muted">연락처</span><input className="w-full border border-line bg-paper px-3 py-2" onChange={(event) => setEditPhone(event.target.value)} value={editPhone} /></label><button className="flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={busy} onClick={saveProfile} type="button"><Edit3 size={13} /> 회원 정보 저장</button></div><dl className="mt-6 divide-y divide-line border-y border-line text-xs"><div className="flex justify-between py-3"><dt className="text-muted">이메일</dt><dd>{selected.email || "-"}</dd></div><div className="flex justify-between py-3"><dt className="text-muted">경고 / 제재</dt><dd>{selected.warning_count ?? 0} / {selected.sanction_count ?? 0}</dd></div><div className="flex justify-between py-3"><dt className="text-muted">기본 배송지</dt><dd>{selected.address_count}개</dd></div><div className="flex justify-between py-3"><dt className="text-muted">상담 상태</dt><dd>{selected.support_status ?? "없음"}</dd></div></dl></> : <div className="grid min-h-64 place-items-center text-center text-xs text-muted"><div><UserRound className="mx-auto" size={26} /><p className="mt-4">회원을 선택하면<br />상세 정보와 관리 기능이 표시됩니다.</p></div></div>}</aside></div>
  </div>;
}
