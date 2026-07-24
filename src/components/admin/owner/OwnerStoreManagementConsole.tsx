"use client";

import {
  Archive,
  Building2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  UserMinus,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { useSupabaseSession } from "@/hooks/useSupabaseSession";

interface Business {
  id: string;
  code: string;
  name: string;
}

interface Operator {
  id: string;
  displayName: string;
  roleCode: "operator" | "owner";
  assignable: boolean;
}

interface Employee {
  id: string;
  displayName: string;
  reportsToOperatorId: string | null;
}

interface StoreEmployee {
  membershipId: string;
  userId: string;
  displayName: string;
  version: number;
}

interface ManagedStore {
  id: string;
  businessId: string;
  businessName: string;
  slug: string;
  name: string;
  description: string;
  operatorId: string;
  operatorName: string;
  isActive: boolean;
  version: number;
  employees: StoreEmployee[];
}

interface ManagementDirectory {
  businesses: Business[];
  operators: Operator[];
  employees: Employee[];
  stores: ManagedStore[];
}

interface StoreDraft {
  slug: string;
  name: string;
  description: string;
  operatorId: string;
}

const emptyDirectory: ManagementDirectory = {
  businesses: [],
  operators: [],
  employees: [],
  stores: [],
};

function storeDraft(store: ManagedStore): StoreDraft {
  return {
    slug: store.slug,
    name: store.name,
    description: store.description,
    operatorId: store.operatorId,
  };
}

export function OwnerStoreManagementConsole() {
  const { loading: sessionLoading, session } = useSupabaseSession();
  const token = session?.access_token ?? null;
  const [directory, setDirectory] =
    useState<ManagementDirectory>(emptyDirectory);
  const [drafts, setDrafts] = useState<Record<string, StoreDraft>>({});
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, string>>(
    {},
  );
  const [newStore, setNewStore] = useState({
    businessId: "",
    slug: "",
    name: "",
    description: "",
    operatorId: "",
  });
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const keys = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/stores", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        management?: Partial<ManagementDirectory>;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? "센터(매장) 목록을 불러오지 못했습니다.",
        );
      }
      const management: ManagementDirectory = {
        businesses: payload.management?.businesses ?? [],
        operators: payload.management?.operators ?? [],
        employees: payload.management?.employees ?? [],
        stores: payload.management?.stores ?? [],
      };
      setDirectory(management);
      setDrafts(
        Object.fromEntries(
          management.stores.map((store) => [store.id, storeDraft(store)]),
        ),
      );
      setNewStore((current) => ({
        ...current,
        businessId:
          current.businessId || management.businesses.at(0)?.id || "",
        operatorId:
          current.operatorId ||
          management.operators.find((operator) => operator.assignable)?.id ||
          "",
      }));
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "센터(매장) 목록을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const activeStores = useMemo(
    () => directory.stores.filter((store) => store.isActive),
    [directory.stores],
  );
  const archivedStores = useMemo(
    () => directory.stores.filter((store) => !store.isActive),
    [directory.stores],
  );

  const mutate = async (
    scope: string,
    body: Record<string, unknown>,
    successMessage: string,
  ) => {
    if (!token) return false;
    const idempotencyKey = keys.current.get(scope) ?? crypto.randomUUID();
    keys.current.set(scope, idempotencyKey);
    setBusyKey(scope);
    setNotice("");
    try {
      const response = await fetch("/api/admin/owner/stores", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 409) await load();
        throw new Error(
          payload.message ?? payload.error ?? "변경 사항을 저장하지 못했습니다.",
        );
      }
      keys.current.delete(scope);
      await load();
      setNotice(successMessage);
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "변경 사항을 저장하지 못했습니다.",
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const createStore = async () => {
    const scope = `create:${newStore.slug}`;
    const created = await mutate(
      scope,
      { action: "create", ...newStore },
      "센터(매장)를 추가했습니다.",
    );
    if (created) {
      setNewStore((current) => ({
        ...current,
        slug: "",
        name: "",
        description: "",
      }));
    }
  };

  const saveStore = async (store: ManagedStore) => {
    const draft = drafts[store.id] ?? storeDraft(store);
    await mutate(
      `update:${store.id}:${store.version}`,
      {
        action: "update",
        storeId: store.id,
        expectedVersion: store.version,
        ...draft,
      },
      "센터(매장) 정보와 운영자 배치를 저장했습니다.",
    );
  };

  const archiveStore = async (store: ManagedStore) => {
    if (
      !window.confirm(
        `“${store.name}”을 삭제할까요?\n과거 상품·배송 기록은 보존되며 삭제된 센터(매장)에서 복구할 수 있습니다.`,
      )
    ) {
      return;
    }
    await mutate(
      `archive:${store.id}:${store.version}`,
      {
        action: "archive",
        storeId: store.id,
        expectedVersion: store.version,
      },
      "센터(매장)를 삭제했습니다. 과거 기록은 그대로 보존됩니다.",
    );
  };

  const restoreStore = async (store: ManagedStore) => {
    await mutate(
      `restore:${store.id}:${store.version}`,
      {
        action: "restore",
        storeId: store.id,
        expectedVersion: store.version,
      },
      "센터(매장)를 다시 운영 상태로 복구했습니다.",
    );
  };

  const assignEmployee = async (store: ManagedStore) => {
    const employeeId = employeeDrafts[store.id];
    if (!employeeId) {
      setNotice("배치할 직원을 선택해 주세요.");
      return;
    }
    const assigned = await mutate(
      `employee_assign:${store.id}:${employeeId}:${store.version}`,
      {
        action: "employee_assign",
        storeId: store.id,
        employeeId,
        expectedStoreVersion: store.version,
        expectedMembershipVersion: null,
      },
      "직원을 센터(매장)에 배치했습니다.",
    );
    if (assigned) {
      setEmployeeDrafts((current) => ({ ...current, [store.id]: "" }));
    }
  };

  const removeEmployee = async (
    store: ManagedStore,
    employee: StoreEmployee,
  ) => {
    await mutate(
      `employee_remove:${store.id}:${employee.userId}:${employee.version}`,
      {
        action: "employee_remove",
        storeId: store.id,
        employeeId: employee.userId,
        expectedStoreVersion: store.version,
        expectedMembershipVersion: employee.version,
      },
      "직원 배치를 해제했습니다.",
    );
  };

  if (!sessionLoading && !token) {
    return (
      <div className="border border-dashed border-line p-8 text-sm text-muted">
        관리자 계정으로 로그인해 주세요.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <SectionHeading
        action={
          <button
            className="flex items-center gap-2 border border-line px-4 py-3 text-xs font-bold disabled:opacity-40"
            disabled={loading}
            onClick={() => void load()}
            type="button"
          >
            <RefreshCw size={14} /> 새로고침
          </button>
        }
        description="센터와 매장은 같은 업무 단위입니다. 이곳에서 매장을 만들고 담당 운영자와 직원을 배치합니다."
        eyebrow="관리자 / 센터·인력"
        title="센터(매장) 관리"
        variant="page"
      />

      {notice && (
        <div
          aria-live="polite"
          className="border border-line bg-surface px-5 py-4 text-sm"
        >
          {notice}
        </div>
      )}

      <section className="border border-ink p-5 md:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid size-9 place-items-center bg-ink text-paper">
            <Plus size={17} />
          </span>
          <div>
            <h2 className="text-lg font-black">센터(매장) 추가</h2>
            <p className="mt-1 text-xs text-muted">
              주소나 별도 물류 경로 없이 실제 상품을 보관·발송하는 매장을
              등록합니다.
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-bold">
            사업체
            <select
              className="mt-2 w-full border border-line bg-paper px-3 py-3 text-sm"
              onChange={(event) =>
                setNewStore((current) => ({
                  ...current,
                  businessId: event.target.value,
                }))
              }
              value={newStore.businessId}
            >
              {directory.businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            담당 운영자
            <select
              className="mt-2 w-full border border-line bg-paper px-3 py-3 text-sm"
              onChange={(event) =>
                setNewStore((current) => ({
                  ...current,
                  operatorId: event.target.value,
                }))
              }
              value={newStore.operatorId}
            >
              <option value="">운영자 선택</option>
              {directory.operators
                .filter((operator) => operator.assignable)
                .map((operator) => (
                  <option key={operator.id} value={operator.id}>
                    {operator.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            매장 코드
            <input
              className="mt-2 w-full border border-line px-3 py-3 font-mono text-sm"
              maxLength={80}
              onChange={(event) =>
                setNewStore((current) => ({
                  ...current,
                  slug: event.target.value.toLowerCase(),
                }))
              }
              pattern="[a-z0-9-]{2,80}"
              placeholder="예: seoul-store"
              value={newStore.slug}
            />
          </label>
          <label className="text-xs font-bold">
            매장 이름
            <input
              className="mt-2 w-full border border-line px-3 py-3 text-sm"
              maxLength={80}
              onChange={(event) =>
                setNewStore((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="화면에 표시할 센터(매장) 이름"
              value={newStore.name}
            />
          </label>
          <label className="text-xs font-bold md:col-span-2">
            설명
            <textarea
              className="mt-2 min-h-24 w-full resize-y border border-line px-3 py-3 text-sm"
              maxLength={1000}
              onChange={(event) =>
                setNewStore((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="내부에서 구분하기 위한 간단한 설명"
              value={newStore.description}
            />
          </label>
        </div>
        <button
          className="mt-5 flex items-center gap-2 bg-ink px-5 py-3 text-xs font-bold text-paper disabled:opacity-40"
          disabled={
            busyKey !== null ||
            !newStore.businessId ||
            !newStore.operatorId ||
            !newStore.slug ||
            !newStore.name
          }
          onClick={() => void createStore()}
          type="button"
        >
          <Plus size={14} /> 센터(매장) 추가
        </button>
        {directory.operators.every((operator) => !operator.assignable) && (
          <p className="mt-4 text-xs text-amber-800">
            먼저{" "}
            <Link className="underline" href="/admin/owner/members">
              회원·권한
            </Link>
            에서 운영자 계정을 지정해 주세요.
          </p>
        )}
      </section>

      <section>
        <div className="mb-5 flex items-end justify-between border-b border-ink pb-4">
          <div>
            <p className="eyebrow text-muted">운영 중</p>
            <h2 className="mt-2 text-xl font-black">
              센터(매장) {activeStores.length}곳
            </h2>
          </div>
        </div>
        <div className="space-y-5">
          {activeStores.map((store) => {
            const draft = drafts[store.id] ?? storeDraft(store);
            const assignedIds = new Set(
              store.employees.map((employee) => employee.userId),
            );
            const availableEmployees = directory.employees.filter(
              (employee) => !assignedIds.has(employee.id),
            );
            return (
              <article className="border border-line" key={store.id}>
                <div className="flex flex-col gap-3 border-b border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <Building2 size={18} />
                    <div>
                      <h3 className="font-black">{store.name}</h3>
                      <p className="mt-1 text-[11px] text-muted">
                        {store.businessName} · 담당 {store.operatorName}
                      </p>
                    </div>
                  </div>
                  <span className="w-fit bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
                    운영 중
                  </span>
                </div>

                <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]">
                  <div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="text-xs font-bold">
                        매장 코드
                        <input
                          className="mt-2 w-full border border-line px-3 py-3 font-mono text-sm"
                          maxLength={80}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [store.id]: {
                                ...draft,
                                slug: event.target.value.toLowerCase(),
                              },
                            }))
                          }
                          value={draft.slug}
                        />
                      </label>
                      <label className="text-xs font-bold">
                        매장 이름
                        <input
                          className="mt-2 w-full border border-line px-3 py-3 text-sm"
                          maxLength={80}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [store.id]: {
                                ...draft,
                                name: event.target.value,
                              },
                            }))
                          }
                          value={draft.name}
                        />
                      </label>
                      <label className="text-xs font-bold sm:col-span-2">
                        담당 운영자
                        <select
                          className="mt-2 w-full border border-line bg-paper px-3 py-3 text-sm"
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [store.id]: {
                                ...draft,
                                operatorId: event.target.value,
                              },
                            }))
                          }
                          value={draft.operatorId}
                        >
                          {directory.operators.map((operator) => (
                            <option
                              disabled={!operator.assignable}
                              key={operator.id}
                              value={operator.id}
                            >
                              {operator.displayName}
                              {!operator.assignable ? " (기존 관리자 담당)" : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs font-bold sm:col-span-2">
                        설명
                        <textarea
                          className="mt-2 min-h-24 w-full resize-y border border-line px-3 py-3 text-sm"
                          maxLength={1000}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [store.id]: {
                                ...draft,
                                description: event.target.value,
                              },
                            }))
                          }
                          value={draft.description}
                        />
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        className="flex items-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40"
                        disabled={busyKey !== null}
                        onClick={() => void saveStore(store)}
                        type="button"
                      >
                        <Save size={14} /> 수정 저장
                      </button>
                      <button
                        className="flex items-center gap-2 border border-red-300 px-4 py-3 text-xs font-bold text-red-700 disabled:opacity-40"
                        disabled={busyKey !== null}
                        onClick={() => void archiveStore(store)}
                        type="button"
                      >
                        <Archive size={14} /> 삭제
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                    <h4 className="text-sm font-black">직원 배치</h4>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      이 매장에서 실제 업무를 처리할 직원만 개별 배치합니다.
                    </p>
                    <div className="mt-4 space-y-2">
                      {store.employees.map((employee) => (
                        <div
                          className="flex items-center justify-between border border-line px-3 py-3"
                          key={employee.membershipId}
                        >
                          <span className="text-sm font-bold">
                            {employee.displayName}
                          </span>
                          <button
                            aria-label={`${employee.displayName} 배치 해제`}
                            className="flex items-center gap-1 text-xs font-bold text-red-700 disabled:opacity-40"
                            disabled={busyKey !== null}
                            onClick={() =>
                              void removeEmployee(store, employee)
                            }
                            type="button"
                          >
                            <UserMinus size={14} /> 해제
                          </button>
                        </div>
                      ))}
                      {store.employees.length === 0 && (
                        <div className="border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                          배치된 직원이 없습니다.
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <select
                        aria-label={`${store.name}에 배치할 직원`}
                        className="min-w-0 flex-1 border border-line bg-paper px-3 py-3 text-sm"
                        onChange={(event) =>
                          setEmployeeDrafts((current) => ({
                            ...current,
                            [store.id]: event.target.value,
                          }))
                        }
                        value={employeeDrafts[store.id] ?? ""}
                      >
                        <option value="">직원 선택</option>
                        {availableEmployees.map((employee) => (
                          <option key={employee.id} value={employee.id}>
                            {employee.displayName}
                            {employee.reportsToOperatorId &&
                            employee.reportsToOperatorId !== store.operatorId
                              ? " (담당 운영자 변경)"
                              : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={`${store.name}에 직원 배치`}
                        className="grid size-11 shrink-0 place-items-center bg-ink text-paper disabled:opacity-40"
                        disabled={
                          busyKey !== null || !employeeDrafts[store.id]
                        }
                        onClick={() => void assignEmployee(store)}
                        type="button"
                      >
                        <UserPlus size={16} />
                      </button>
                    </div>
                    {directory.employees.length === 0 && (
                      <p className="mt-3 text-xs text-amber-800">
                        <Link className="underline" href="/admin/owner/members">
                          회원·권한
                        </Link>
                        에서 직원 계정을 먼저 지정해 주세요.
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
          {!loading && activeStores.length === 0 && (
            <div className="border border-dashed border-line py-12 text-center text-sm text-muted">
              운영 중인 센터(매장)가 없습니다.
            </div>
          )}
        </div>
      </section>

      {archivedStores.length > 0 && (
        <section>
          <div className="mb-5 border-b border-ink pb-4">
            <p className="eyebrow text-muted">기록 보존</p>
            <h2 className="mt-2 text-xl font-black">
              삭제된 센터(매장) {archivedStores.length}곳
            </h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {archivedStores.map((store) => (
              <article
                className="flex items-center justify-between border border-line p-5"
                key={store.id}
              >
                <div>
                  <h3 className="font-bold">{store.name}</h3>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    {store.slug}
                  </p>
                </div>
                <button
                  className="flex items-center gap-2 border border-line px-3 py-2 text-xs font-bold disabled:opacity-40"
                  disabled={busyKey !== null}
                  onClick={() => void restoreStore(store)}
                  type="button"
                >
                  <RotateCcw size={13} /> 복구
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
