"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, MapPinned, Plus, RefreshCw, Route, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface Store {
  id: string;
  business_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
}

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

interface StoreRoute {
  id: string;
  business_id: string;
  store_id: string;
  fulfillment_center_id: string;
  route_mode: "transfer" | "co_located";
  status: string;
  version: number;
  updated_at: string;
}

interface StaffAccount {
  id: string;
  display_name: string;
  email: string | null;
  role_code: "operator" | "employee";
  last_seen_at: string | null;
}

interface CenterAssignment {
  id: string;
  business_id: string;
  fulfillment_center_id: string;
  user_id: string;
  status: "active" | "inactive";
  receive_at_center: boolean;
  create_shipments: boolean;
  version: number;
  updated_at: string;
}

interface RolloutSetting {
  business_id: string;
  entitlement_projection_enabled: boolean;
  unified_inventory_reads_enabled: boolean;
  item_selected_shipments_enabled: boolean;
  shipping_fee_amount: number;
  version: number;
  updated_at: string;
}

interface OperationalHealthBusiness {
  businessId: string;
  businessName: string;
  reconciliationRequired: number;
  blockedItems: number;
  overdueItems: number;
  openExceptions: number;
  pendingRefunds: number;
  pendingShippingFees: number;
  rollout: { projection: boolean; reads: boolean; shipments: boolean };
}

interface ReconciliationItem {
  inventoryItemId: string;
  productId: string;
  title: string;
  imageUrl: string;
  businessId: string;
  originStoreId: string;
  originStoreName: string;
  paidAt: string;
  paidAmount: number;
  fulfillmentVersion: number;
  targetCenterId: string | null;
  targetCenterName: string | null;
  targetRouteMode: "transfer" | "co_located" | null;
  targetRouteVersion: number | null;
}

interface RolloutDraft {
  projection: boolean;
  reads: boolean;
  shipments: boolean;
  shippingFeeAmount: string;
}

interface SetupPayload {
  stores?: Store[];
  centers?: FulfillmentCenter[];
  routes?: StoreRoute[];
  staff?: StaffAccount[];
  assignments?: CenterAssignment[];
  rollouts?: RolloutSetting[];
  health?: { businesses: OperationalHealthBusiness[]; serverTime: string };
  reconciliationItems?: ReconciliationItem[];
  error?: string;
  message?: string;
}

interface RouteDraft {
  centerId: string;
  routeMode: "transfer" | "co_located";
  reason: string;
}

interface CenterDraft {
  code: string;
  name: string;
  postalCode: string;
  addressLine1: string;
  addressLine2: string;
  contactName: string;
  contactPhone: string;
}

const emptyCenterDraft: CenterDraft = {
  code: "", name: "", postalCode: "", addressLine1: "", addressLine2: "", contactName: "", contactPhone: "",
};

function centerDraft(center: FulfillmentCenter): CenterDraft {
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

function routeDraft(route: StoreRoute | undefined): RouteDraft {
  return {
    centerId: route?.fulfillment_center_id ?? "",
    routeMode: route?.route_mode ?? "transfer",
    reason: "",
  };
}

function requestKey(actorId: string, scope: string) {
  const key = `owner-fulfillment:${actorId}:${scope}`;
  const existing = window.sessionStorage.getItem(key);
  if (existing) return { key, value: existing };
  const value = crypto.randomUUID();
  window.sessionStorage.setItem(key, value);
  return { key, value };
}

export function OwnerFulfillmentConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [centers, setCenters] = useState<FulfillmentCenter[]>([]);
  const [routes, setRoutes] = useState<StoreRoute[]>([]);
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [assignments, setAssignments] = useState<CenterAssignment[]>([]);
  const [rollouts, setRollouts] = useState<RolloutSetting[]>([]);
  const [health, setHealth] = useState<OperationalHealthBusiness[]>([]);
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [reconciliationReasons, setReconciliationReasons] = useState<Record<string, string>>({});
  const [routeDrafts, setRouteDrafts] = useState<Record<string, RouteDraft>>({});
  const [rolloutDrafts, setRolloutDrafts] = useState<Record<string, RolloutDraft>>({});
  const [assignmentCenterId, setAssignmentCenterId] = useState("");
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentStatus, setAssignmentStatus] = useState<"active" | "inactive">("active");
  const [newCenter, setNewCenter] = useState<CenterDraft>(emptyCenterDraft);
  const [centerDrafts, setCenterDrafts] = useState<Record<string, CenterDraft>>({});
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  async function configureCenter(action: "create_center" | "update_center" | "archive_center", center?: FulfillmentCenter) {
    if (!token || !actorId) return;
    const draft = action === "create_center" ? newCenter : center ? centerDrafts[center.id] ?? centerDraft(center) : emptyCenterDraft;
    const code = action === "archive_center" ? center?.code ?? "archived" : draft.code.trim();
    const name = action === "archive_center" ? center?.name ?? "보관된 센터" : draft.name.trim();
    if (action === "create_center" && (!code || !name)) { setNotice("센터 코드와 이름을 입력해 주세요."); return; }
    if (action === "archive_center" && center && !window.confirm(`${center.name} 센터를 목록에서 삭제할까요?`)) return;
    setBusyTarget(`center:${center?.id ?? "new"}`); setNotice("");
    const response = await fetch("/api/admin/owner/fulfillment", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ action, centerId: center?.id ?? null, code, name, isDefault: center?.is_default ?? false, postalCode: draft.postalCode, addressLine1: draft.addressLine1, addressLine2: draft.addressLine2, contactName: draft.contactName, contactPhone: draft.contactPhone, expectedVersion: center?.version ?? 0, idempotencyKey: crypto.randomUUID() }) });
    const payload = await response.json() as { message?: string; error?: string };
    setBusyTarget(null);
    if (!response.ok) { setNotice(payload.message ?? payload.error ?? "센터를 변경하지 못했습니다."); return; }
    setNewCenter(emptyCenterDraft); setNotice(action === "create_center" ? "센터를 추가했습니다." : action === "archive_center" ? "센터를 보관 삭제했습니다." : "센터를 수정했습니다."); await load(token);
  }

  const load = useCallback(async (
    accessToken: string,
    preferredAssignmentCenterId?: string,
    preferredAssignmentUserId?: string,
  ) => {
    const response = await fetch("/api/admin/owner/fulfillment", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json() as SetupPayload;
    if (!response.ok) {
      throw new Error(payload.message ?? "물류 설정을 불러오지 못했습니다.");
    }
    const nextStores = Array.isArray(payload.stores) ? payload.stores : [];
    const nextCenters = Array.isArray(payload.centers) ? payload.centers : [];
    const nextRoutes = Array.isArray(payload.routes) ? payload.routes : [];
    const nextStaff = Array.isArray(payload.staff) ? payload.staff : [];
    const nextAssignments = Array.isArray(payload.assignments) ? payload.assignments : [];
    const nextRollouts = Array.isArray(payload.rollouts) ? payload.rollouts : [];
    const nextHealth = Array.isArray(payload.health?.businesses) ? payload.health.businesses : [];
    const nextReconciliationItems = Array.isArray(payload.reconciliationItems) ? payload.reconciliationItems : [];
    const selected = nextCenters.find((center) => center.is_default) ?? nextCenters[0];

    setStores(nextStores);
    setCenters(nextCenters);
    setCenterDrafts(Object.fromEntries(nextCenters.map((center) => [center.id, centerDraft(center)])));
    setRoutes(nextRoutes);
    setStaff(nextStaff);
    setAssignments(nextAssignments);
    setRollouts(nextRollouts);
    setHealth(nextHealth);
    setReconciliationItems(nextReconciliationItems);
    setRouteDrafts(Object.fromEntries(nextStores.map((store) => [
      store.id,
      routeDraft(nextRoutes.find((route) => route.store_id === store.id)),
    ])));
    setRolloutDrafts(Object.fromEntries(nextRollouts.map((rollout) => [
      rollout.business_id,
      {
        projection: rollout.entitlement_projection_enabled,
        reads: rollout.unified_inventory_reads_enabled,
        shipments: rollout.item_selected_shipments_enabled,
        shippingFeeAmount: String(rollout.shipping_fee_amount),
      },
    ])));
    const assignmentCenter = nextCenters.find((center) => center.id === preferredAssignmentCenterId) ?? selected;
    const assignmentStaff = nextStaff.find((candidate) => candidate.id === preferredAssignmentUserId) ?? nextStaff[0];
    const assignment = nextAssignments.find((candidate) =>
      candidate.fulfillment_center_id === assignmentCenter?.id && candidate.user_id === assignmentStaff?.id
    );
    setAssignmentCenterId(assignmentCenter?.id ?? "");
    setAssignmentUserId(assignmentStaff?.id ?? "");
    setAssignmentStatus(assignment?.status ?? "active");
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
        setActorId(session.user.id);
        await load(session.access_token);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "물류 설정을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const selectedAssignment = assignments.find((assignment) =>
    assignment.fulfillment_center_id === assignmentCenterId && assignment.user_id === assignmentUserId
  );

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      await load(token, assignmentCenterId, assignmentUserId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "새로고침하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const updateRouteDraft = (storeId: string, field: keyof RouteDraft, value: string) => {
    setRouteDrafts((current) => ({
      ...current,
      [storeId]: { ...(current[storeId] ?? routeDraft(undefined)), [field]: value },
    }));
  };

  const updateRolloutDraft = (businessId: string, patch: Partial<RolloutDraft>) => {
    setRolloutDrafts((current) => ({
      ...current,
      [businessId]: {
        ...(current[businessId] ?? { projection: false, reads: false, shipments: false, shippingFeeAmount: "" }),
        ...patch,
      },
    }));
  };

  const chooseAssignment = (centerId: string, userId: string) => {
    const existing = assignments.find((assignment) =>
      assignment.fulfillment_center_id === centerId && assignment.user_id === userId
    );
    setAssignmentCenterId(centerId);
    setAssignmentUserId(userId);
    setAssignmentStatus(existing?.status ?? "active");
  };

  const saveRoute = async (store: Store) => {
    if (!token || !actorId || busyTarget) return;
    const existing = routes.find((route) => route.store_id === store.id);
    const draft = routeDrafts[store.id] ?? routeDraft(existing);
    const center = centers.find((candidate) => candidate.id === draft.centerId);
    if (!center || center.status !== "active" || center.business_id !== store.business_id) {
      setNotice("같은 사업자의 사용 중인 센터를 선택해 주세요.");
      return;
    }
    const expectedVersion = existing?.version ?? 0;
    const idempotency = requestKey(
      actorId,
      `route:${store.id}:${expectedVersion}:${draft.centerId}:${draft.routeMode}:${draft.reason.trim()}`,
    );
    setBusyTarget(`route:${store.id}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          storeId: store.id,
          centerId: draft.centerId,
          routeMode: draft.routeMode,
          expectedVersion,
          idempotencyKey: idempotency.value,
          reason: draft.reason.trim() || null,
        }),
      });
      const payload = await response.json() as SetupPayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, assignmentCenterId, assignmentUserId);
          throw new Error("다른 담당자가 먼저 변경했습니다. 최신 경로로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "매장 경로를 저장하지 못했습니다.");
      }
      window.sessionStorage.removeItem(idempotency.key);
      setNotice(`${store.name}의 센터 경로를 저장했습니다.`);
      await load(token, assignmentCenterId, assignmentUserId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "매장 경로를 저장하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const reconcileItem = async (item: ReconciliationItem) => {
    if (!token || !actorId || busyTarget) return;
    const reason = (reconciliationReasons[item.inventoryItemId] ?? "").trim();
    if (!item.targetCenterId || !item.targetRouteMode || item.targetRouteVersion === null) {
      setNotice(`${item.originStoreName}의 활성 센터 경로를 먼저 설정해 주세요.`);
      return;
    }
    if (reason.length < 3 || reason.length > 500) {
      setNotice("기존 상품의 실제 위치를 확인한 사유를 3자 이상 500자 이하로 입력해 주세요.");
      return;
    }
    const idempotency = requestKey(
      actorId,
      `reconcile:${item.inventoryItemId}:${item.fulfillmentVersion}:${item.targetCenterId}:${item.targetRouteVersion}:${reason}`,
    );
    setBusyTarget(`reconcile:${item.inventoryItemId}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconcile_item",
          inventoryItemId: item.inventoryItemId,
          expectedVersion: item.fulfillmentVersion,
          reason,
          idempotencyKey: idempotency.value,
        }),
      });
      const payload = await response.json() as SetupPayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, assignmentCenterId, assignmentUserId);
          throw new Error("상품 경로 상태가 변경되었습니다. 최신 목록으로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "기존 상품의 센터 경로를 적용하지 못했습니다.");
      }
      window.sessionStorage.removeItem(idempotency.key);
      setReconciliationReasons((current) => ({ ...current, [item.inventoryItemId]: "" }));
      setNotice(`${item.title} 상품의 실제 경로 확인을 완료했습니다.`);
      await load(token, assignmentCenterId, assignmentUserId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "기존 상품의 센터 경로를 적용하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const saveAssignment = async () => {
    if (!token || !actorId || busyTarget) return;
    const center = centers.find((candidate) => candidate.id === assignmentCenterId);
    const member = staff.find((candidate) => candidate.id === assignmentUserId);
    if (!center || center.status !== "active" || !member) {
      setNotice("사용 중인 센터와 담당 운영자 또는 직원 계정을 선택해 주세요.");
      return;
    }
    const existing = assignments.find((assignment) =>
      assignment.fulfillment_center_id === center.id && assignment.user_id === member.id
    );
    const expectedVersion = existing?.version ?? 0;
    const idempotency = requestKey(
      actorId,
      `assignment:${center.id}:${member.id}:${expectedVersion}:${member.role_code}:${assignmentStatus}`,
    );
    setBusyTarget(`assignment:${center.id}:${member.id}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "configure_assignment",
          centerId: center.id,
          userId: member.id,
          status: assignmentStatus,
          expectedVersion,
          idempotencyKey: idempotency.value,
        }),
      });
      const payload = await response.json() as SetupPayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, center.id, member.id);
          throw new Error("센터 담당자 권한이 변경되었습니다. 최신 설정으로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "센터 담당자 권한을 저장하지 못했습니다.");
      }
      window.sessionStorage.removeItem(idempotency.key);
      setNotice(`${member.display_name} 담당자의 ${center.name} 권한을 저장했습니다.`);
      await load(token, center.id, member.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "센터 담당자 권한을 저장하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const deleteAssignment = async (assignment: CenterAssignment) => {
    if (!token || !actorId || busyTarget) return;
    const center = centers.find(
      (candidate) => candidate.id === assignment.fulfillment_center_id,
    );
    const member = staff.find((candidate) => candidate.id === assignment.user_id);
    if (!window.confirm(
      `${member?.display_name ?? assignment.user_id} 담당자의 ${center?.name ?? "센터"} 배정을 삭제할까요?`,
    )) {
      return;
    }
    const idempotency = requestKey(
      actorId,
      `assignment-delete:${assignment.id}:${assignment.version}`,
    );
    setBusyTarget(`assignment-delete:${assignment.id}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete_assignment",
          centerId: assignment.fulfillment_center_id,
          userId: assignment.user_id,
          expectedVersion: assignment.version,
          idempotencyKey: idempotency.value,
        }),
      });
      const payload = await response.json() as SetupPayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, assignmentCenterId, assignmentUserId);
          throw new Error("센터 배정이 변경되어 최신 목록으로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "센터 배정을 삭제하지 못했습니다.");
      }
      window.sessionStorage.removeItem(idempotency.key);
      setNotice("센터 배정을 삭제했습니다.");
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "센터 배정을 삭제하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  const saveRollout = async (rollout: RolloutSetting) => {
    if (!token || !actorId || busyTarget) return;
    const draft = rolloutDrafts[rollout.business_id];
    const shippingFeeAmount = Number(draft?.shippingFeeAmount);
    if (!draft || !Number.isSafeInteger(shippingFeeAmount) || shippingFeeAmount < 1 || shippingFeeAmount > 1_000_000) {
      setNotice("배송비는 1원 이상 1,000,000원 이하 정수로 입력해 주세요.");
      return;
    }
    if ((draft.reads && !draft.projection) || (draft.shipments && (!draft.projection || !draft.reads))) {
      setNotice("권리는 ‘결제 권리 생성 → 통합 보관함 읽기 → 선택 배송’ 순서로 활성화하고, 비활성화는 반대 순서로 진행해 주세요.");
      return;
    }
    const idempotency = requestKey(actorId, `rollout:${rollout.business_id}:${rollout.version}:${draft.projection}:${draft.reads}:${draft.shipments}:${shippingFeeAmount}`);
    setBusyTarget(`rollout:${rollout.business_id}`);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/fulfillment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "configure_rollout",
          businessId: rollout.business_id,
          entitlementProjectionEnabled: draft.projection,
          unifiedInventoryReadsEnabled: draft.reads,
          itemSelectedShipmentsEnabled: draft.shipments,
          shippingFeeAmount,
          expectedVersion: rollout.version,
          idempotencyKey: idempotency.value,
        }),
      });
      const payload = await response.json() as SetupPayload;
      if (!response.ok) {
        if (response.status === 409) {
          await load(token, assignmentCenterId, assignmentUserId);
          throw new Error("전환 설정이 변경되었습니다. 최신 상태로 새로고침했습니다.");
        }
        throw new Error(payload.message ?? "단계별 전환 설정을 저장하지 못했습니다.");
      }
      window.sessionStorage.removeItem(idempotency.key);
      setNotice("단계별 전환 설정과 중앙 배송비를 저장했습니다.");
      await load(token, assignmentCenterId, assignmentUserId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "단계별 전환 설정을 저장하지 못했습니다.");
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <div className="space-y-9">
      <header className="flex flex-col items-stretch justify-between gap-5 border-b border-ink pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow text-muted">소유자 / 물류 설정</p>
          <h1 className="mt-3 text-3xl font-black tracking-[-.06em] sm:text-4xl sm:tracking-[-.08em]">매장 → 센터 경로·권한</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">각 실제 매장이 결제 완료 상품을 어느 실제 센터로 보내는지 설정합니다. 매장 이름이나 식별자를 자동으로 추론하지 않습니다.</p>
        </div>
        <button className="flex items-center justify-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40" disabled={!token || loading} onClick={() => void refresh()} type="button"><RefreshCw size={14} /> 새로고침</button>
      </header>

      {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-sm">{notice}</div>}

      <section className="border border-line p-5 sm:p-6" aria-busy={loading}>
        <div className="border-b border-line pb-5"><p className="eyebrow text-muted">안전한 단계별 전환</p><h2 className="mt-2 text-xl font-black">통합 물류 운영 상태</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted">결제 권리 생성, 통합 보관함 읽기, 선택 배송을 순서대로 켭니다. 미조정 상품과 활성 매장 경로가 남아 있으면 서버가 선택 배송 활성화를 거부합니다.</p></div>
        <div className="mt-5 space-y-4">{rollouts.map((rollout) => {
          const draft = rolloutDrafts[rollout.business_id] ?? { projection: false, reads: false, shipments: false, shippingFeeAmount: String(rollout.shipping_fee_amount) };
          const operational = health.find((business) => business.businessId === rollout.business_id);
          return <article className="border border-line p-5" key={rollout.business_id}>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-sm font-black">{operational?.businessName ?? rollout.business_id}</p><p className="mt-1 font-mono text-[10px] text-muted">설정 v{rollout.version} · {new Date(rollout.updated_at).toLocaleString("ko-KR")}</p></div><div className="flex flex-wrap gap-2 text-[10px] font-bold"><span className="border border-line px-2 py-1">미조정 {operational?.reconciliationRequired ?? 0}</span><span className="border border-line px-2 py-1">보류 {operational?.blockedItems ?? 0}</span><span className="border border-line px-2 py-1">기한 초과 {operational?.overdueItems ?? 0}</span><span className="border border-line px-2 py-1">예외 {operational?.openExceptions ?? 0}</span><span className="border border-line px-2 py-1">환불 {operational?.pendingRefunds ?? 0}</span><span className="border border-line px-2 py-1">배송비 입금 {operational?.pendingShippingFees ?? 0}</span></div></div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end"><fieldset><legend className="text-xs font-bold">전환 단계</legend><div className="mt-2 flex min-h-11 flex-col gap-3 border border-line p-3 text-xs sm:flex-row sm:items-center sm:gap-6"><label className="flex items-center gap-2"><input checked={draft.projection} onChange={(event) => updateRolloutDraft(rollout.business_id, { projection: event.target.checked })} type="checkbox" /> 1. 결제 권리 생성</label><label className="flex items-center gap-2"><input checked={draft.reads} onChange={(event) => updateRolloutDraft(rollout.business_id, { reads: event.target.checked })} type="checkbox" /> 2. 통합 보관함</label><label className="flex items-center gap-2"><input checked={draft.shipments} onChange={(event) => updateRolloutDraft(rollout.business_id, { shipments: event.target.checked })} type="checkbox" /> 3. 선택 배송</label></div></fieldset><label className="text-xs font-bold">중앙 배송비<input className="mt-2 h-11 w-full border border-line px-3 font-mono font-normal" inputMode="numeric" maxLength={7} onChange={(event) => updateRolloutDraft(rollout.business_id, { shippingFeeAmount: event.target.value.replace(/\D/g, "") })} value={draft.shippingFeeAmount} /></label><button className="flex h-11 items-center justify-center gap-2 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget)} onClick={() => void saveRollout(rollout)} type="button"><Save size={14} /> {busyTarget === `rollout:${rollout.business_id}` ? "저장 중" : "전환 설정 저장"}</button></div>
          </article>;
        })}{!loading && rollouts.length === 0 && <p className="border border-dashed border-line p-5 text-sm text-muted">단계별 전환 설정이 없습니다. 마이그레이션 적용 상태를 확인해 주세요.</p>}</div>
      </section>

      <section className="border border-line p-5 sm:p-6" aria-busy={loading}>
        <div className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end"><div><p className="eyebrow text-muted">센터 직접 관리</p><h2 className="mt-2 text-xl font-black">센터 추가·수정·삭제</h2><p className="mt-2 text-xs leading-5 text-muted">삭제는 과거 이력을 유지하는 보관 삭제로 처리하며 진행 중인 상품이 있으면 차단됩니다.</p></div><MapPinned className="text-muted" size={22}/></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input aria-label="새 센터 코드" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={80} onChange={(event)=>setNewCenter((current)=>({...current,code:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"")}))} placeholder="center-code" value={newCenter.code}/>
          <input aria-label="새 센터 이름" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={120} onChange={(event)=>setNewCenter((current)=>({...current,name:event.target.value}))} placeholder="센터 이름" value={newCenter.name}/>
          <input aria-label="새 센터 우편번호" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={20} onChange={(event)=>setNewCenter((current)=>({...current,postalCode:event.target.value}))} placeholder="우편번호" value={newCenter.postalCode}/>
          <input aria-label="새 센터 기본 주소" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={240} onChange={(event)=>setNewCenter((current)=>({...current,addressLine1:event.target.value}))} placeholder="기본 주소" value={newCenter.addressLine1}/>
          <input aria-label="새 센터 상세 주소" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={240} onChange={(event)=>setNewCenter((current)=>({...current,addressLine2:event.target.value}))} placeholder="상세 주소" value={newCenter.addressLine2}/>
          <input aria-label="새 센터 담당자" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={80} onChange={(event)=>setNewCenter((current)=>({...current,contactName:event.target.value}))} placeholder="담당자" value={newCenter.contactName}/>
          <input aria-label="새 센터 연락처" className="h-11 border border-line bg-paper px-3 text-xs" maxLength={40} onChange={(event)=>setNewCenter((current)=>({...current,contactPhone:event.target.value}))} placeholder="연락처" value={newCenter.contactPhone}/>
          <button className="inline-flex h-11 items-center justify-center gap-2 bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget)||!newCenter.code||!newCenter.name.trim()} onClick={()=>void configureCenter("create_center")} type="button"><Plus size={14}/> 센터 추가</button>
        </div>
        <div className="mt-5 divide-y divide-line border-y border-line">{centers.filter((center)=>center.status!=="archived").map((center)=>{const draft=centerDrafts[center.id]??centerDraft(center);const updateDraft=(key:keyof CenterDraft,value:string)=>setCenterDrafts((current)=>({...current,[center.id]:{...draft,[key]:value}}));return <div className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-center" key={center.id}><input aria-label={`${center.name} 코드`} className="h-10 border border-line bg-paper px-3 font-mono text-xs" onChange={(event)=>updateDraft("code",event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,""))} value={draft.code}/><input aria-label={`${center.name} 이름`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("name",event.target.value)} value={draft.name}/><input aria-label={`${center.name} 우편번호`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("postalCode",event.target.value)} placeholder="우편번호" value={draft.postalCode}/><input aria-label={`${center.name} 기본 주소`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("addressLine1",event.target.value)} placeholder="기본 주소" value={draft.addressLine1}/><input aria-label={`${center.name} 상세 주소`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("addressLine2",event.target.value)} placeholder="상세 주소" value={draft.addressLine2}/><input aria-label={`${center.name} 담당자`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("contactName",event.target.value)} placeholder="담당자" value={draft.contactName}/><input aria-label={`${center.name} 연락처`} className="h-10 border border-line bg-paper px-3 text-xs" onChange={(event)=>updateDraft("contactPhone",event.target.value)} placeholder="연락처" value={draft.contactPhone}/><div className="flex gap-2"><button className="flex-1 border border-line px-3 py-2 text-xs font-bold" disabled={Boolean(busyTarget)||!draft.code||!draft.name.trim()} onClick={()=>void configureCenter("update_center",center)} type="button"><Save className="mr-1 inline" size={12}/> 수정</button><button className="px-3 py-2 text-xs font-bold text-rose-700" disabled={Boolean(busyTarget)} onClick={()=>void configureCenter("archive_center",center)} type="button"><Trash2 className="mr-1 inline" size={12}/> 삭제</button></div></div>;})}</div>
      </section>

      <section className="border border-line p-5 sm:p-6" aria-busy={loading}>
        <div className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow text-muted">전환 전 상품 확인</p>
            <h2 className="mt-2 text-xl font-black">미조정 보관 상품 경로 적용</h2>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-muted">기존 결제 상품의 실제 위치를 확인한 뒤, 원산지 매장에 설정된 현재 센터 경로를 한 건씩 적용합니다. 확인되지 않은 상품은 선택 배송 활성화를 계속 차단합니다.</p>
          </div>
          <span className="w-fit border border-line px-3 py-1 text-[10px] font-bold">미조정 {reconciliationItems.length}건</span>
        </div>
        <div className="mt-5 space-y-4">
          {reconciliationItems.map((item) => {
            const reason = reconciliationReasons[item.inventoryItemId] ?? "";
            const routeReady = Boolean(item.targetCenterId && item.targetCenterName && item.targetRouteMode && item.targetRouteVersion !== null);
            return (
              <article className="grid gap-4 border border-line p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,380px)]" key={item.inventoryItemId}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-sm font-black">{item.title}</p><p className="mt-1 text-[11px] text-muted">{item.originStoreName} · 결제 {new Date(item.paidAt).toLocaleString("ko-KR")} · {item.paidAmount.toLocaleString("ko-KR")}원</p></div>
                    <span className={`border px-2 py-1 text-[10px] font-bold ${routeReady ? "border-emerald-300 text-emerald-700" : "border-rose-300 text-rose-700"}`}>{routeReady ? `${item.targetCenterName} 경로 준비` : "매장 경로 필요"}</span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted">현재 물류 버전 v{item.fulfillmentVersion}{item.targetRouteMode ? ` · ${item.targetRouteMode === "transfer" ? "센터 이동" : "같은 장소 입고"}` : ""}</p>
                </div>
                <div>
                  <input aria-label={`${item.title} 실제 위치 확인 사유`} className="h-11 w-full border border-line px-3 text-xs" maxLength={500} onChange={(event) => setReconciliationReasons((current) => ({ ...current, [item.inventoryItemId]: event.target.value }))} placeholder="예: B센터 실물 보관 위치 확인 완료" value={reason} />
                  <button className="mt-3 flex w-full items-center justify-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={!routeReady || reason.trim().length < 3 || Boolean(busyTarget)} onClick={() => void reconcileItem(item)} type="button"><CheckCircle2 size={14} /> {busyTarget === `reconcile:${item.inventoryItemId}` ? "경로 적용 중" : "실제 경로 확인 완료"}</button>
                </div>
              </article>
            );
          })}
          {!loading && reconciliationItems.length === 0 && <p className="border border-dashed border-line p-5 text-sm text-muted">미조정 보관 상품이 없습니다.</p>}
        </div>
      </section>

      <section className="border border-line p-5 sm:p-6" aria-busy={loading}>
        <div className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
          <div><p className="eyebrow text-muted">명시적 경로 설정</p><h2 className="mt-2 text-xl font-black">각 매장별 센터 연결</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted">센터로 이동은 매장 상품을 센터로 이관한 뒤 입고 처리합니다. 같은 장소 즉시 센터 입고는 동일 물리 장소에서 센터 입고를 시작합니다.</p></div>
          <MapPinned className="text-muted" size={22} />
        </div>

        <div className="mt-5 space-y-4">
          {stores.map((store) => {
            const existing = routes.find((route) => route.store_id === store.id);
            const draft = routeDrafts[store.id] ?? routeDraft(existing);
            const compatibleCenters = centers.filter((center) => center.business_id === store.business_id && center.status === "active");
            const selectedRouteCenter = centers.find((center) => center.id === existing?.fulfillment_center_id);
            return (
              <article className="border border-line p-5" key={store.id}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div><p className="text-base font-black">{store.name}</p><p className="mt-1 font-mono text-[10px] text-muted">매장 ID {store.id}</p></div>
                  {!store.is_active ? <span className="border border-amber-300 px-2 py-1 text-[10px] font-bold text-amber-700">비활성 매장</span> : existing?.status === "active" ? <span className="border border-emerald-300 px-2 py-1 text-[10px] font-bold text-emerald-700">경로 설정됨 · v{existing.version}</span> : <span className="border border-rose-300 px-2 py-1 text-[10px] font-bold text-rose-700">경로 미설정</span>}
                </div>
                {existing?.status === "active" ? <p className="mt-3 text-xs text-muted">현재: {selectedRouteCenter?.name ?? "센터 정보 없음"} · {existing.route_mode === "transfer" ? "센터로 이동" : "같은 장소 즉시 센터 입고"}</p> : <p className="mt-3 flex gap-2 border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><AlertTriangle className="shrink-0" size={15} />경로가 설정되지 않은 매장의 결제 완료 상품은 <strong>reconciliation_required</strong>로 분류됩니다.</p>}
                <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-bold">연결할 활성 센터
                      <select className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm font-normal" onChange={(event) => updateRouteDraft(store.id, "centerId", event.target.value)} value={draft.centerId}>
                        <option value="">센터를 명시적으로 선택해 주세요</option>
                        {compatibleCenters.map((center) => <option key={center.id} value={center.id}>{center.name} · {center.code}</option>)}
                      </select>
                    </label>
                    <fieldset><legend className="text-xs font-bold">입고 방식</legend><div className="mt-2 flex min-h-11 gap-4 border border-line px-3 text-xs"><label className="flex items-center gap-2"><input checked={draft.routeMode === "transfer"} name={`route-mode-${store.id}`} onChange={() => updateRouteDraft(store.id, "routeMode", "transfer")} type="radio" />센터로 이동</label><label className="flex items-center gap-2"><input checked={draft.routeMode === "co_located"} name={`route-mode-${store.id}`} onChange={() => updateRouteDraft(store.id, "routeMode", "co_located")} type="radio" />같은 장소 즉시 센터 입고</label></div></fieldset>
                    <label className="text-xs font-bold sm:col-span-2">변경 사유 <span className="font-normal text-muted">(선택)</span>
                      <input className="mt-2 h-11 w-full border border-line px-3 text-sm font-normal" maxLength={1_000} onChange={(event) => updateRouteDraft(store.id, "reason", event.target.value)} placeholder="예: 매장 물리 위치와 센터 입고 절차 변경" value={draft.reason} />
                    </label>
                  </div>
                  <button className="flex h-11 items-center justify-center gap-2 self-end bg-ink px-4 text-xs font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget) || !store.is_active || !draft.centerId} onClick={() => void saveRoute(store)} type="button"><Route size={14} /> {busyTarget === `route:${store.id}` ? "저장 중" : "경로 저장"}</button>
                </div>
              </article>
            );
          })}
          {!loading && stores.length === 0 && <p className="border border-dashed border-line p-5 text-sm text-muted">등록된 실제 매장이 없습니다.</p>}
          {loading && stores.length === 0 && <p className="py-12 text-center text-sm text-muted">매장과 센터 설정을 불러오는 중입니다.</p>}
        </div>
      </section>

      <section className="border border-line p-5 sm:p-6" aria-busy={loading}>
        <div className="flex flex-col justify-between gap-3 border-b border-line pb-5 sm:flex-row sm:items-end">
          <div><p className="eyebrow text-muted">역할 기반 센터 권한</p><h2 className="mt-2 text-xl font-black">운영자·직원 센터 배정</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-muted">소유자는 운영자와 직원을 센터에 배정만 합니다. 입고·보관과 포장·송장 업무 권한은 역할에서 자동 결정되며 개별 체크박스로 바꿀 수 없습니다. 운영자는 센터·매장 운영과 결제를 관리하고, 직원은 배정 센터 실무를 수행합니다.</p></div>
          <MapPinned className="text-muted" size={22} />
        </div>
        {centers.length > 0 && staff.length > 0 ? <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="text-xs font-bold">담당 센터
            <select className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm font-normal" onChange={(event) => chooseAssignment(event.target.value, assignmentUserId)} value={assignmentCenterId}>
              {centers.filter((center) => center.status === "active").map((center) => <option key={center.id} value={center.id}>{center.name} · {center.code}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold">담당 운영자 또는 직원
            <select className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm font-normal" onChange={(event) => chooseAssignment(assignmentCenterId, event.target.value)} value={assignmentUserId}>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.display_name} · {member.role_code === "operator" ? "운영자" : "직원"}{member.email ? ` · ${member.email}` : ""}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold lg:col-span-2">배정 상태
            <select className="mt-2 h-11 w-full border border-line bg-paper px-3 text-sm font-normal" onChange={(event) => setAssignmentStatus(event.target.value as "active" | "inactive")} value={assignmentStatus}>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </select>
          </label>
          <div className="flex flex-col justify-between gap-3 border border-line bg-surface p-4 text-xs sm:flex-row sm:items-center lg:col-span-2"><p>{selectedAssignment ? `현재 배정 버전 v${selectedAssignment.version}` : "새 센터 배정"} · 선택한 역할의 권한 프로필이 자동 적용됩니다.</p><button className="flex shrink-0 items-center justify-center gap-2 bg-ink px-4 py-3 font-bold text-paper disabled:opacity-40" disabled={Boolean(busyTarget) || !assignmentCenterId || !assignmentUserId} onClick={() => void saveAssignment()} type="button"><Save size={14} /> {busyTarget === `assignment:${assignmentCenterId}:${assignmentUserId}` ? "저장 중" : "센터 배정 저장"}</button></div>
          {assignments.length > 0 && <div className="divide-y divide-line border-y border-line lg:col-span-2">{assignments.map((assignment) => { const center = centers.find((candidate) => candidate.id === assignment.fulfillment_center_id); const member = staff.find((candidate) => candidate.id === assignment.user_id); const roleLabel = member?.role_code === "operator" ? "운영자" : "직원"; return <div className="flex flex-col justify-between gap-3 py-3 text-xs sm:flex-row sm:items-center" key={assignment.id}><div><p><strong>{member?.display_name ?? assignment.user_id}</strong>{member ? ` · ${roleLabel}` : ""} · {center?.name ?? assignment.fulfillment_center_id}</p><p className="mt-1 text-muted">{assignment.status === "active" ? "활성" : "비활성"} · 역할 기반 입고·보관·포장·송장 · v{assignment.version}</p></div><div className="flex gap-2"><button className="border border-line px-3 py-2 font-bold" disabled={Boolean(busyTarget)} onClick={() => chooseAssignment(assignment.fulfillment_center_id, assignment.user_id)} type="button">수정</button><button className="inline-flex items-center gap-1 border border-rose-300 px-3 py-2 font-bold text-rose-700" disabled={Boolean(busyTarget)} onClick={() => void deleteAssignment(assignment)} type="button"><Trash2 size={12}/> 삭제</button></div></div>; })}</div>}
        </div> : <p className="mt-5 border border-dashed border-line p-5 text-sm text-muted">활성 센터와 운영자 또는 직원 계정이 모두 있어야 센터 권한을 배정할 수 있습니다.</p>}
      </section>

      <section className="border border-line bg-surface p-5 text-sm leading-6">
        <p className="font-bold">상품 입고·보관·출고 처리는 권한이 배정된 운영자·직원 통합 물류에서 진행합니다.</p>
        <p className="mt-1 text-muted">발송인 센터 주소는 수집하지 않습니다. 이 화면에서 매장별 경로와 센터 담당 권한을 관리합니다.</p>
        <Link className="mt-4 inline-flex items-center gap-2 border border-line bg-paper px-4 py-2 text-xs font-bold" href="/admin/operator/fulfillment"><Route size={14} /> 운영자 통합 물류 열기</Link>
      </section>
    </div>
  );
}
