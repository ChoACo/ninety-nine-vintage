"use client";

import { Layers } from "lucide-react";
import { useEffect } from "react";
import { useOperatorStoreScope } from "@/store/useOperatorStoreScope";

export function OperatorStoreScopeSelector() {
  const { scope, stores, loaded, busy, load, select } =
    useOperatorStoreScope();

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Layers size={14} /> 센터 범위 불러오는 중…
      </div>
    );
  }

  const savedStoreId =
    scope.scope === "store" ? scope.storeId ?? null : null;
  const savedStoreAvailable =
    savedStoreId !== null && stores.some((store) => store.id === savedStoreId);
  const value = savedStoreAvailable ? savedStoreId : "all";

  const onChange = (nextValue: string) => {
    const next =
      nextValue === "all"
        ? { scope: "all" as const, storeId: null }
        : { scope: "store" as const, storeId: nextValue };
    void select(next);
  };

  return (
    <label className="flex items-center gap-2 text-xs font-bold">
      <Layers size={14} />
      <span className="text-muted">센터 범위</span>
      <select
        aria-label="운영자 센터 범위"
        className="border border-line bg-paper px-3 py-2 text-xs"
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="all">전체 센터</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
    </label>
  );
}
