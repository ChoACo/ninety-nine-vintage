"use client";

import { Layers } from "lucide-react";
import { useEffect } from "react";
import { useOperatorStoreScope } from "@/store/useOperatorStoreScope";

export function OperatorStoreScopeSelector() {
  const { scope, stores, loaded, busy, error, load, select } =
    useOperatorStoreScope();

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!scope.active || !scope.expiresAt) return;
    const delay = Math.max(
      0,
      new Date(scope.expiresAt).getTime() - new Date().getTime(),
    );
    const timeout = window.setTimeout(() => void load(), delay + 50);
    return () => window.clearTimeout(timeout);
  }, [load, scope.active, scope.expiresAt]);

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Layers size={14} /> 센터 범위 불러오는 중…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-700">
        <span>{error}</span>
        <button className="font-bold underline" disabled={busy} onClick={() => void load()} type="button">
          다시 시도
        </button>
      </div>
    );
  }

  const savedStoreId = scope.active ? scope.storeId : null;
  const savedStoreAvailable =
    savedStoreId !== null && stores.some((store) => store.id === savedStoreId);
  const value = savedStoreAvailable ? savedStoreId : "";

  const onChange = async (nextValue: string) => {
    if (!nextValue) return;
    const next = {
      active: true,
      accessMode: scope.accessMode,
      storeId: nextValue,
      expiresAt: null,
    };
    if (await select(next)) window.location.reload();
  };

  return (
    <label className="flex items-center gap-2 text-xs font-bold">
      <Layers size={14} />
      <span className="text-muted">센터 범위</span>
      <select
        aria-label="운영자 센터 범위"
        className="border border-line bg-paper px-3 py-2 text-xs"
        disabled={busy}
        onChange={(event) => void onChange(event.target.value)}
        value={value}
      >
        <option disabled value="">센터를 선택하세요</option>
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name}
          </option>
        ))}
      </select>
    </label>
  );
}
