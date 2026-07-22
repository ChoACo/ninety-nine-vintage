"use client";

import { AlertTriangle, Archive, PackageCheck, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface FulfillmentCenter {
  id: string;
  business_id: string;
  code: string;
  name: string;
  status: string;
  is_default: boolean;
  postal_code: string | null;
  address_line1: string | null;
  address_line2: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  version: number;
  updated_at: string;
}

interface FulfillmentItem {
  orderItemId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  paymentStatus: string;
  stage: string;
  locationKind: string;
  storageLocationCode: string | null;
  isBlocked: boolean;
  blockReason: string | null;
  version: number;
  updatedAt: string;
}

interface CenterWork {
  work_id: string;
  order_id: string;
  store_id: string;
  store_name: string;
  business_id: string;
  work_status: string;
  work_version: number;
  order_status: string;
  order_created_at: string;
  center_id: string;
  center_name: string;
  center_status: string;
  active_item_count: number;
  received_item_count: number;
  stored_item_count: number;
  blocked_item_count: number;
  items: FulfillmentItem[];
}

interface QueuePayload {
  centers?: FulfillmentCenter[];
  works?: CenterWork[];
  error?: string;
  message?: string;
}

interface CenterForm {
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  contactName: string;
  contactPhone: string;
}

interface ItemDraft {
  storageLocationCode: string;
  reasonCode: string;
  note: string;
}

type CenterAction = "receive" | "store" | "report_issue" | "resolve_issue";

const emptyCenterForm: CenterForm = {
  postalCode: "",
  addressLine1: "",
  addressLine2: "",
  contactName: "",
  contactPhone: "",
};

const emptyItemDraft: ItemDraft = {
  storageLocationCode: "",
  reasonCode: "",
  note: "",
};

const stageLabels: Record<string, string> = {
  in_transit_to_center: "중앙으로 이동 중",
  center_received: "입고 확인",
  center_stored: "보관 위치 배정",
};

function centerForm(center: FulfillmentCenter): CenterForm {
  return {
    postalCode: center.postal_code ?? "",
    addressLine1: center.address_line1 ?? "",
    addressLine2: center.address_line2 ?? "",
    contactName: center.contact_name ?? "",
    contactPhone: center.contact_phone ?? "",
  };
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "주문 시각 미확인" : date.toLocaleString("ko-KR");
}

export function OwnerFulfillmentConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [centers, setCenters] = useState<FulfillmentCenter[]>([]);
  const [works, setWorks] = useState<CenterWork[]>([]);
  const [selectedCenterId, setSelectedCenterId] = useState("");
  const [form, setForm] = useState<CenterForm>(emptyCenterForm);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string, preferredCenterId?: string) => {
    const response = await fetch("/api/admin/owner/fulfillment", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json() as QueuePayload;
    if (!response.ok) {
      throw new Error(payload.message ?? "중앙 물류 목록을 불러오지 못했습니다.");
    }
    const nextCenters = Array.isArray(payload.centers) ? payload.centers : [];
    const nextWorks = Array.isArray(payload.works) ? payload.works : [];
    const selected = nextCenters.find((center) => center.id === preferredCenterId) ??
      nextCenters.find((center) => center.is_default) ?? nextCenters[0];
    setCenters(nextCenters);
    setWorks(nextWorks);
    setSelectedCenterId(selected?.id ?? "");
    setForm(selected ? centerForm(selected) : emptyCenterForm);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        if (!session) {
          setNotice("소유자 계정으로 로그인해 주세요.");
          return;
        }
        setToken(session.access_token);
        await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "중앙 물류 목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const selectedCenter = centers.find((center) => center.id === selectedCenterId) ?? null;

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      await load(token, selectedCenterId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "새로고침하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const chooseCenter = (centerId: string) => {
    const center = centers.find((candidate) => candidate.id === centerId);
    setSelectedCenterId(centerId);
    setForm(center ? centerForm(center) : emptyCenterForm);
  };

  const updateCenterField = (field: keyof CenterForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveCenter = async () => {
    if (!token || !selectedCenter || busyTarget) return;
    setBusyTarget(selectedCenter.id);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          centerId: selectedCenter.id,
          expectedVersion: selectedCenter.version,
          ...form,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, selectedCenter.id);
          throw new Error("다른 담당자가 먼저 변경했습니다. 최신 센터 정보로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "중앙 출고지 설정을 저장하지 못했습니다.");
      }
      setNotice("중앙 출고지의 실제 주소와 연락처를 저장했습니다.");
      await load(token, selectedCenter.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "중앙 출고지 설정을 저장하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const updateDraft = (itemId: string, field: keyof ItemDraft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [itemId]: { ...(current[itemId] ?? emptyItemDraft), [field]: value },
    }));
  };

  const actOnItem = async (item: FulfillmentItem, action: CenterAction) => {
    if (!token || busyTarget) return;
    const draft = drafts[item.orderItemId] ?? emptyItemDraft;
    setBusyTarget(item.orderItemId);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderItemId: item.orderItemId,
          expectedVersion: item.version,
          action,
          idempotencyKey: crypto.randomUUID(),
          storageLocationCode: action === "store" ? draft.storageLocationCode : null,
          reasonCode: action === "report_issue" || action === "resolve_issue" ? draft.reasonCode : null,
          note: action === "report_issue" || action === "resolve_issue" ? draft.note : null,
        }),
      });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, selectedCenterId);
          throw new Error("다른 담당자가 먼저 변경했습니다. 최신 목록으로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "중앙 물류 작업을 저장하지 못했습니다.");
      }
      const successMessage: Record<CenterAction, string> = {
        receive: "중앙 입고를 확인했습니다.",
        store: "보관 위치를 저장했습니다.",
        report_issue: "상품 확인 요청을 등록했습니다.",
        resolve_issue: "상품 확인을 마치고 작업 차단을 해제했습니다.",
      };
      setNotice(successMessage[action]);
      setDrafts((current) => ({ ...current, [item.orderItemId]: emptyItemDraft }));
      await load(token, selectedCenterId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "중앙 물류 작업을 저장하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const inTransitCount = works.reduce(
    (sum, work) => sum + work.items.filter((item) => item.stage === "in_transit_to_center").length,
    0,
  );
  const receivedCount = works.reduce((sum, work) => sum + Number(work.received_item_count), 0);
  const blockedCount = works.reduce((sum, work) => sum + Number(work.blocked_item_count), 0);

  return (
    <div className="space-y-9">
      <header className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">소유자 / 중앙 물류</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">중앙 입고 센터</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">매장에서 넘어온 상품의 실제 입고, 보관 위치, 확인이 필요한 문제를 순서대로 기록합니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={!token || loading} onClick={() => void refresh()} type="button"><RefreshCw size={14} /> 새로고침</button>
      </header>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-sm">{notice}</div>}

      <section className="border border-line p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
          <div><p className="eyebrow text-muted">필수 설정</p><h2 className="mt-2 text-xl font-black">중앙 출고지 실제 정보</h2><p className="mt-2 text-xs leading-5 text-muted">가상의 주소는 사용하지 않습니다. 실제 상품을 받을 장소와 연락처를 입력해 주세요.</p></div>
          {selectedCenter && <span className={`w-fit border px-3 py-1 text-[10px] font-bold ${selectedCenter.status === "active" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}`}>{selectedCenter.status === "active" ? "사용 중" : "설정 필요"}</span>}
        </div>

        {centers.length > 0 ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <label className="text-xs font-bold lg:col-span-2">출고지
              <select className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm font-normal" onChange={(event) => chooseCenter(event.target.value)} value={selectedCenterId}>
                {centers.map((center) => <option key={center.id} value={center.id}>{center.name}{center.is_default ? " · 기본" : ""}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold">우편번호
              <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" inputMode="numeric" maxLength={5} onChange={(event) => updateCenterField("postalCode", event.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="5자리" value={form.postalCode} />
            </label>
            <label className="text-xs font-bold">담당자 이름
              <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" maxLength={80} onChange={(event) => updateCenterField("contactName", event.target.value)} value={form.contactName} />
            </label>
            <label className="text-xs font-bold lg:col-span-2">기본 주소
              <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" maxLength={500} onChange={(event) => updateCenterField("addressLine1", event.target.value)} placeholder="도로명 주소" value={form.addressLine1} />
            </label>
            <label className="text-xs font-bold">상세 주소
              <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" maxLength={500} onChange={(event) => updateCenterField("addressLine2", event.target.value)} placeholder="층, 호수 등 (선택)" value={form.addressLine2} />
            </label>
            <label className="text-xs font-bold">담당자 연락처
              <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" maxLength={30} onChange={(event) => updateCenterField("contactPhone", event.target.value)} placeholder="실제 연락 가능한 번호" value={form.contactPhone} />
            </label>
            <div className="lg:col-span-2">
              <button className="flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40 sm:w-auto" disabled={Boolean(busyTarget)} onClick={() => void saveCenter()} type="button"><Save size={14} /> {busyTarget === selectedCenterId ? "저장 중" : "실제 출고지 정보 저장"}</button>
            </div>
          </div>
        ) : (
          <p className="mt-5 border border-dashed border-line p-5 text-sm text-muted">등록된 중앙 출고지가 없습니다.</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-px border border-line bg-line sm:grid-cols-3">
        <div className="bg-paper p-5"><p className="text-xs text-muted">입고 확인 대기</p><p className="mt-3 font-mono text-3xl font-bold">{inTransitCount}</p></div>
        <div className="bg-paper p-5"><p className="text-xs text-muted">보관 위치 배정 대기</p><p className="mt-3 font-mono text-3xl font-bold">{receivedCount}</p></div>
        <div className={blockedCount > 0 ? "bg-rose-950 p-5 text-white" : "bg-ink p-5 text-paper"}><p className="text-xs text-zinc-400">확인 필요한 상품</p><p className="mt-3 font-mono text-3xl font-bold">{blockedCount}</p></div>
      </div>

      <section className="space-y-5" aria-busy={loading}>
        {works.map((work) => (
          <article className="border border-line" key={work.work_id}>
            <div className="flex flex-col justify-between gap-3 border-b border-line bg-surface p-5 sm:flex-row sm:items-start">
              <div><p className="text-sm font-black">{work.store_name} → {work.center_name}</p><p className="mt-2 break-all text-[11px] text-muted">주문 {work.order_id} · {dateLabel(work.order_created_at)}</p></div>
              <div className="flex flex-wrap gap-2 text-[10px] font-bold"><span className="border border-line bg-paper px-2 py-1">상품 {work.active_item_count}</span>{work.blocked_item_count > 0 && <span className="border border-rose-300 bg-paper px-2 py-1 text-rose-700">확인 필요 {work.blocked_item_count}</span>}</div>
            </div>
            <div className="divide-y divide-line">
              {work.items.map((item) => {
                const draft = drafts[item.orderItemId] ?? emptyItemDraft;
                const isBusy = busyTarget === item.orderItemId;
                const isAtCenter = item.stage === "center_received" || item.stage === "center_stored";
                return (
                  <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]" key={item.orderItemId}>
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-bold">{item.title}</p><p className="mt-2 text-xs text-muted">{stageLabels[item.stage] ?? item.stage}{item.storageLocationCode ? ` · ${item.storageLocationCode}` : ""}</p></div>{item.isBlocked && <AlertTriangle className="shrink-0 text-rose-700" size={18} />}</div>
                      <p className="mt-4 break-all font-mono text-[10px] text-muted">상품 기록 {item.orderItemId}</p>
                      {item.isBlocked && <p className="mt-3 border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">확인 내용: {item.blockReason}</p>}
                    </div>

                    <div className="border border-line p-4">
                      {item.stage === "in_transit_to_center" && !item.isBlocked && (
                        <button className="flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget)} onClick={() => void actOnItem(item, "receive")} type="button"><PackageCheck size={14} /> {isBusy ? "저장 중" : "실물 입고 확인"}</button>
                      )}

                      {item.stage === "center_received" && !item.isBlocked && (
                        <div>
                          <label className="text-xs font-bold">보관 위치
                            <input className="mt-2 h-10 w-full border border-line px-3 text-xs font-normal" maxLength={120} onChange={(event) => updateDraft(item.orderItemId, "storageLocationCode", event.target.value)} placeholder="예: A-03-02" value={draft.storageLocationCode} />
                          </label>
                          <button className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget) || !draft.storageLocationCode.trim()} onClick={() => void actOnItem(item, "store")} type="button"><Archive size={14} /> {isBusy ? "저장 중" : "보관 위치 저장"}</button>
                        </div>
                      )}

                      {isAtCenter && (
                        <div className={item.stage === "center_received" && !item.isBlocked ? "mt-5 border-t border-line pt-5" : ""}>
                          <p className="text-xs font-bold">{item.isBlocked ? "확인 완료 처리" : "상품 문제 등록"}</p>
                          <select aria-label={`${item.title} 사유 분류`} className="mt-3 h-10 w-full border border-line bg-paper px-3 text-xs" onChange={(event) => updateDraft(item.orderItemId, "reasonCode", event.target.value)} value={draft.reasonCode}>
                            <option value="">사유를 선택해 주세요</option>
                            {item.isBlocked ? (
                              <><option value="checked_ok">검수 후 정상 확인</option><option value="corrected">문제 조치 완료</option><option value="other">기타</option></>
                            ) : (
                              <><option value="damaged">상품 손상</option><option value="wrong_item">상품 불일치</option><option value="missing_information">정보 확인 필요</option><option value="other">기타</option></>
                            )}
                          </select>
                          <textarea aria-label={`${item.title} 처리 내용`} className="mt-2 min-h-20 w-full resize-y border border-line p-3 text-xs" maxLength={1_000} onChange={(event) => updateDraft(item.orderItemId, "note", event.target.value)} placeholder={item.isBlocked ? "확인 결과와 조치 내용을 적어 주세요." : "발견한 문제를 구체적으로 적어 주세요."} value={draft.note} />
                          <button className={`mt-3 flex w-full items-center justify-center gap-2 px-4 py-3 text-xs font-bold disabled:opacity-40 ${item.isBlocked ? "bg-ink text-paper" : "border border-rose-700 text-rose-800"}`} disabled={Boolean(busyTarget) || !draft.reasonCode || !draft.note.trim()} onClick={() => void actOnItem(item, item.isBlocked ? "resolve_issue" : "report_issue")} type="button">{item.isBlocked ? "확인 완료 · 작업 재개" : "문제 등록 · 작업 멈춤"}</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}

        {!loading && works.length === 0 && <div className="border border-dashed border-line py-16 text-center text-sm text-muted">현재 중앙에서 처리할 상품이 없습니다.</div>}
        {loading && works.length === 0 && <div className="py-16 text-center text-sm text-muted">중앙 물류 목록을 불러오는 중입니다.</div>}
      </section>
    </div>
  );
}
