"use client";

import { MapPinned, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface Center {
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
  receive_at_center: boolean;
  create_shipments: boolean;
}

interface Store {
  id: string;
  name: string;
  slug: string;
  home_fulfillment_center_id: string | null;
}

interface Draft {
  code: string;
  name: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  contactName: string;
  contactPhone: string;
}

const emptyDraft: Draft = {
  code: "",
  name: "",
  postalCode: "",
  addressLine1: "",
  addressLine2: "",
  contactName: "",
  contactPhone: "",
};

function toDraft(center: Center): Draft {
  return {
    code: center.code,
    name: center.name,
    postalCode: center.postal_code ?? "",
    addressLine1: center.address_line1 ?? "",
    addressLine2: center.address_line2 ?? "",
    contactName: center.contact_name ?? "",
    contactPhone: center.contact_phone ?? "",
  };
}

export function StaffCenterManagementConsole() {
  const { session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [roleCode, setRoleCode] = useState("");
  const [centers, setCenters] = useState<Center[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newCenter, setNewCenter] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/centers", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json() as {
        roleCode?: string;
        centers?: Center[];
        stores?: Store[];
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "센터 정보를 불러오지 못했습니다.");
      const nextCenters = payload.centers ?? [];
      setRoleCode(payload.roleCode ?? "");
      setCenters(nextCenters);
      setStores(payload.stores ?? []);
      setDrafts(Object.fromEntries(nextCenters.map((center) => [center.id, toDraft(center)])));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "센터 정보를 불러오지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const mutate = async (
    action: "create" | "update" | "archive",
    center: Center | null,
  ) => {
    if (!token || busy) return;
    const draft = center ? drafts[center.id] ?? toDraft(center) : newCenter;
    if (action === "archive" && center && !window.confirm(`${center.name} 센터를 삭제할까요?`)) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/centers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action,
          centerId: center?.id ?? null,
          code: draft.code,
          name: draft.name,
          isDefault: center?.is_default ?? false,
          postalCode: draft.postalCode,
          addressLine1: draft.addressLine1,
          addressLine2: draft.addressLine2,
          contactName: draft.contactName,
          contactPhone: draft.contactPhone,
          expectedVersion: center?.version ?? 0,
        }),
      });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "센터 정보를 저장하지 못했습니다.");
      setNewCenter(emptyDraft);
      setNotice(
        action === "create"
          ? "센터를 추가했습니다."
          : action === "archive"
            ? "센터를 삭제했습니다."
            : "센터 정보를 저장했습니다.",
      );
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "센터 정보를 저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = (centerId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({
      ...current,
      [centerId]: { ...(current[centerId] ?? emptyDraft), [field]: value },
    }));
  };

  const field = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
  ) => (
    <label className="grid gap-2 text-[10px] font-bold">
      {label}
      <input
        className="h-10 border border-line bg-paper px-3 text-xs font-normal"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );

  return (
    <div className="space-y-8">
      <SectionHeading
        action={<button className="inline-flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold" disabled={busy} onClick={() => void load()} type="button"><RefreshCw size={14} /> 새로고침</button>}
        description="배정된 센터의 주소·연락처·담당 업무와 연결 매장을 관리합니다."
        eyebrow={roleCode === "employee" ? "직원센터 / 센터 관리" : "운영자 / 센터 관리"}
        title="센터 관리"
        variant="page"
      />
      {notice && <p className="border border-line bg-surface px-4 py-3 text-xs" role="status">{notice}</p>}

      {roleCode === "operator" && (
        <section className="border border-line bg-surface p-5">
          <div className="flex items-center gap-2"><Plus size={16} /><h2 className="text-sm font-black">센터 추가</h2></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {field("센터 코드", newCenter.code, (value) => setNewCenter((current) => ({ ...current, code: value.toLowerCase().replace(/[^a-z0-9-]/g, "") })), "center-code")}
            {field("센터 이름", newCenter.name, (value) => setNewCenter((current) => ({ ...current, name: value })), "센터 이름")}
            {field("우편번호", newCenter.postalCode, (value) => setNewCenter((current) => ({ ...current, postalCode: value })), "우편번호")}
            {field("기본 주소", newCenter.addressLine1, (value) => setNewCenter((current) => ({ ...current, addressLine1: value })), "기본 주소")}
            {field("상세 주소", newCenter.addressLine2, (value) => setNewCenter((current) => ({ ...current, addressLine2: value })), "상세 주소")}
            {field("담당자", newCenter.contactName, (value) => setNewCenter((current) => ({ ...current, contactName: value })), "담당자")}
            {field("연락처", newCenter.contactPhone, (value) => setNewCenter((current) => ({ ...current, contactPhone: value })), "연락처")}
            <button className="h-10 self-end bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || newCenter.code.length < 2 || !newCenter.name.trim()} onClick={() => void mutate("create", null)} type="button">센터 추가</button>
          </div>
        </section>
      )}

      <div className="grid gap-5">
        {centers.map((center) => {
          const draft = drafts[center.id] ?? toDraft(center);
          const linkedStores = stores.filter((store) => store.home_fulfillment_center_id === center.id);
          return (
            <article className="border border-line p-5" key={center.id}>
              <header className="flex flex-col justify-between gap-3 border-b border-line pb-4 sm:flex-row sm:items-center">
                <div>
                  <p className="flex items-center gap-2 text-sm font-black"><MapPinned size={15} /> {center.name}</p>
                  <p className="mt-1 text-[10px] text-muted">입고 {center.receive_at_center ? "가능" : "조회 전용"} · 택배 {center.create_shipments ? "가능" : "조회 전용"} · v{center.version}</p>
                </div>
                <p className="text-xs text-muted">연결 매장 {linkedStores.length}개</p>
              </header>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {field("센터 코드", draft.code, (value) => updateDraft(center.id, "code", value.toLowerCase().replace(/[^a-z0-9-]/g, "")), "center-code")}
                {field("센터 이름", draft.name, (value) => updateDraft(center.id, "name", value), "센터 이름")}
                {field("우편번호", draft.postalCode, (value) => updateDraft(center.id, "postalCode", value), "우편번호")}
                {field("기본 주소", draft.addressLine1, (value) => updateDraft(center.id, "addressLine1", value), "기본 주소")}
                {field("상세 주소", draft.addressLine2, (value) => updateDraft(center.id, "addressLine2", value), "상세 주소")}
                {field("담당자", draft.contactName, (value) => updateDraft(center.id, "contactName", value), "담당자")}
                {field("연락처", draft.contactPhone, (value) => updateDraft(center.id, "contactPhone", value), "연락처")}
                <div className="flex items-end gap-2">
                  <button className="inline-flex h-10 flex-1 items-center justify-center gap-1 border border-line px-3 text-xs font-bold" disabled={busy} onClick={() => void mutate("update", center)} type="button"><Save size={13} /> 저장</button>
                  {roleCode === "operator" && <button aria-label={`${center.name} 삭제`} className="grid size-10 place-items-center text-rose-700" disabled={busy} onClick={() => void mutate("archive", center)} type="button"><Trash2 size={15} /></button>}
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">
                {linkedStores.length > 0 ? linkedStores.map((store) => store.name).join(" · ") : "연결된 매장이 없습니다."}
              </p>
            </article>
          );
        })}
        {!busy && centers.length === 0 && <p className="border border-dashed border-line py-14 text-center text-sm text-muted">배정된 센터가 없습니다.</p>}
      </div>
    </div>
  );
}
