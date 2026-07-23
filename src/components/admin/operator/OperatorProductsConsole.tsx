"use client";

import Link from "next/link";
import { ClipboardCheck, Edit3, FileSpreadsheet, PauseCircle, PlayCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  discardUnpersistedProductImages,
  uploadProductImages,
} from "@/lib/supabase/products";
import type {
  BatchAuctionPreview,
  BatchAuctionProgressReporter,
} from "@/lib/import/batchAuction";
import { inferBrandFromTitle } from "@/lib/catalog/brand";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextArea, TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import { OperatorXlsxImportModal } from "@/components/admin/operator/OperatorXlsxImportModal";
import { getNextAuctionDeadline } from "@/utils/formatters";

interface Store { id: string; name: string; canPublish: boolean; }
interface Product {
  id: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  brand_source: "explicit" | "inferred";
  sale_type: string;
  fixed_price: number | null;
  current_price: number;
  starting_price: number;
  bid_increment: number;
  status: string;
  image_urls: string[];
  store_id: string | null;
  size_label: string;
  condition_grade: string;
  storage_class: string;
  publish_at: string;
  closes_at: string;
  inspection_notes: string[];
  updated_at: string;
  stores?: { name: string } | null;
}
type FormState = {
  title: string;
  description: string;
  brand: string;
  category: string;
  storeId: string;
  saleType: "fixed" | "auction";
  price: string;
  imageUrls: string;
  sizeLabel: string;
  conditionGrade: string;
  storageClass: "small" | "large";
  status: "pending" | "active";
  bidIncrement: string;
  publishAt: string;
  closesAt: string;
  inspectionNotes: string;
};

const emptyForm: FormState = {
  title: "", description: "", brand: "", category: "구제 의류", storeId: "", saleType: "fixed", price: "", imageUrls: "",
  sizeLabel: "", conditionGrade: "A", storageClass: "small", status: "active", bidIncrement: "1000", publishAt: "", closesAt: "",
  inspectionNotes: "",
};

const FIXED_PRODUCT_OPEN_UNTIL = "9999-12-31T23:59:59.000Z";

function splitImages(value: string) { return value.split(/[\n,|]/).map((item) => item.trim()).filter((item) => item.startsWith("http")); }
function splitLines(value: string) { return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
function toLocalDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function importedConditionGrade(condition: string | null) {
  if (condition === "새상품") return "S";
  if (condition === "상태 좋음") return "A+";
  if (condition === "사용감 있음") return "B";
  return "A";
}
function productStatusLabel(status: string) {
  if (status === "pending") return "초안";
  if (status === "active") return "공개 중";
  if (status === "closed") return "마감";
  if (status === "sold") return "판매 완료";
  return status;
}
function isManageableProductStatus(status: string) {
  return status === "pending" || status === "active";
}
interface PublishPendingResult {
  requested_count: number;
  published_count: number;
  skipped_count: number;
  published_ids: string[];
  skipped_ids: string[];
}

async function publishProductNow(accessToken: string, productId: string) {
  const response = await fetch(`/api/admin/operator/products/${productId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => null) as {
    result?: PublishPendingResult;
    error?: string;
  } | null;
  if (!response.ok) throw new Error(payload?.error ?? "상품을 공개하지 못했습니다.");

  const result = payload?.result;
  const published = result?.requested_count === 1
    && result.published_count === 1
    && result.skipped_count === 0
    && result.published_ids.includes(productId)
    && !result.skipped_ids.includes(productId);
  if (!published) throw new Error("상품이 공개되지 않아 초안으로 보존했습니다.");
  return result;
}

export function OperatorProductsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({ canCreate: false, canMutate: false, canPublish: false });
  const [filter, setFilter] = useState({ search: "", status: "all", saleType: "all" });
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [xlsxImportOpen, setXlsxImportOpen] = useState(() =>
    typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("import") === "xlsx",
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const inspectionNotesRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/operator/products", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as {
        stores?: Store[];
        products?: Product[];
        permissions?: { canCreate: boolean; canMutate: boolean; canPublish: boolean };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "상품을 불러오지 못했습니다.");
      const nextPermissions = payload.permissions ?? { canCreate: false, canMutate: false, canPublish: false };
      const nextStores = payload.stores ?? [];
      setStores(nextStores);
      setProducts(payload.products ?? []);
      setPermissions(nextPermissions);
      const publishableStoreIds = new Set(nextStores.filter((store) => store.canPublish).map((store) => store.id));
      const pendingIds = new Set((payload.products ?? [])
        .filter((product) => product.status === "pending" && product.store_id !== null && publishableStoreIds.has(product.store_id))
        .map((product) => product.id));
      setSelectedPendingIds((current) => nextPermissions.canPublish
        ? new Set([...current].filter((id) => pendingIds.has(id)))
        : new Set());
      setForm((current) => {
        const storeId = current.storeId || nextStores[0]?.id || "";
        const canPublish = nextStores.find((store) => store.id === storeId)?.canPublish === true;
        return {
          ...current,
          storeId,
          status: current.title ? (canPublish ? current.status : "pending") : (canPublish ? "active" : "pending"),
        };
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession()).data.session;
        setToken(session?.access_token ?? null);
        if (session) await load(session.access_token);
      } catch (error) { setNotice(error instanceof Error ? error.message : "운영자 데이터를 불러오지 못했습니다."); }
    })();
  }, [load]);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const query = filter.search.trim().toLowerCase();
    return (!query || product.title.toLowerCase().includes(query) || product.brand.toLowerCase().includes(query) || (product.stores?.name ?? "").toLowerCase().includes(query))
      && (filter.status === "all" || product.status === filter.status)
      && (filter.saleType === "all" || product.sale_type === filter.saleType);
  }), [filter, products]);
  const visiblePendingIds = useMemo(
    () => permissions.canPublish
      ? visibleProducts
        .filter((product) => product.status === "pending" && stores.some((store) => store.id === product.store_id && store.canPublish))
        .map((product) => product.id)
      : [],
    [permissions.canPublish, stores, visibleProducts],
  );
  const allVisiblePendingSelected = visiblePendingIds.length > 0
    && visiblePendingIds.every((id) => selectedPendingIds.has(id));
  const editingProduct = useMemo(
    () => editingId ? products.find((product) => product.id === editingId) : undefined,
    [editingId, products],
  );
  const productFieldsEditable = editingId
    ? permissions.canMutate && Boolean(editingProduct && isManageableProductStatus(editingProduct.status))
    : permissions.canCreate;
  const saleSetupEditable = editingId
    ? permissions.canMutate && editingProduct?.status === "pending"
    : permissions.canCreate;

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const resetForm = () => {
    setEditingId(null);
    setEditingUpdatedAt(null);
    setForm((current) => {
      const storeId = current.storeId || stores[0]?.id || "";
      const canPublish = stores.find((store) => store.id === storeId)?.canPublish === true;
      return { ...emptyForm, storeId, status: canPublish ? "active" : "pending" };
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true); setNotice("");
    try {
      if (editingId && (!permissions.canMutate || !editingProduct || !editingUpdatedAt || !isManageableProductStatus(editingProduct.status))) {
        throw new Error("수정할 상품의 최신 상태를 확인하지 못했습니다. 목록을 새로고침해 주세요.");
      }
      const shouldPublishAfterSave = stores.find((store) => store.id === form.storeId)?.canPublish === true && form.status === "active"
        && (!editingId || editingProduct?.status === "pending");
      const publishAt = toIsoDateTime(form.publishAt);
      const closesAt = toIsoDateTime(form.closesAt);
      const body = {
        title: form.title, brand: form.brand, description: form.description, category: form.category,
        imageUrls: splitImages(form.imageUrls), sizeLabel: form.sizeLabel, conditionGrade: form.conditionGrade,
        storageClass: form.storageClass, status: shouldPublishAfterSave ? "pending" : form.status,
        expectedUpdatedAt: editingId ? editingUpdatedAt : undefined,
        ...(saleSetupEditable ? {
          storeId: form.storeId,
          saleType: form.saleType,
          startingPrice: Number(form.price),
          fixedPrice: form.saleType === "fixed" ? Number(form.price) : undefined,
          bidIncrement: Number(form.bidIncrement),
          publishAt,
          closesAt,
        } : {}),
        inspectionNotes: splitLines(form.inspectionNotes),
      };
      const response = await fetch(editingId ? `/api/admin/operator/products/${editingId}` : "/api/admin/operator/products", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { product?: { id: string }; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "상품을 저장하지 못했습니다.");
      let message = editingId ? "상품 정보를 저장했습니다." : "상품을 초안으로 저장했습니다.";
      if (shouldPublishAfterSave) {
        if (!payload.product?.id) {
          message = `${editingId ? "상품 정보는 저장했지만" : "상품은 등록했지만"} 즉시 공개 결과를 확인하지 못했습니다. 초안 목록을 확인해 주세요.`;
        } else {
          try {
            await publishProductNow(token, payload.product.id);
            message = editingId ? "상품 정보를 저장하고 지금 공개했습니다." : "상품을 등록하고 지금 공개했습니다.";
          } catch (error) {
            const reason = error instanceof Error ? error.message : "즉시 공개 결과를 확인하지 못했습니다.";
            message = `${editingId ? "상품 정보는 저장했지만" : "상품은 등록했지만"} 즉시 공개하지 못했습니다. ${reason}`;
          }
        }
      }
      setNotice(message); resetForm(); await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const edit = (product: Product, target: "form" | "inspection" = "form") => {
    if (!permissions.canMutate) {
      setNotice("이 매장의 상품 관리 권한이 필요합니다.");
      return;
    }
    if (!isManageableProductStatus(product.status)) {
      setNotice("마감 또는 판매 완료된 상품 기록은 수정할 수 없습니다.");
      return;
    }
    setEditingId(product.id);
    setEditingUpdatedAt(product.updated_at);
    setForm({
      title: product.title,
      brand: product.brand,
      description: product.description ?? "",
      category: product.category ?? "구제 의류",
      storeId: product.store_id ?? stores[0]?.id ?? "",
      saleType: product.sale_type === "fixed" ? "fixed" : "auction",
      price: String(product.fixed_price ?? product.current_price),
      imageUrls: product.image_urls?.join("\n") ?? "",
      sizeLabel: product.size_label ?? "",
      conditionGrade: product.condition_grade ?? "A",
      storageClass: product.storage_class === "large" ? "large" : "small",
      status: product.status === "active" ? "active" : "pending",
      bidIncrement: String(product.bid_increment ?? 1000),
      publishAt: toLocalDateTimeInput(product.publish_at),
      closesAt: toLocalDateTimeInput(product.closes_at),
      inspectionNotes: product.inspection_notes?.join("\n") ?? "",
    });
    if (target === "inspection") {
      window.setTimeout(() => inspectionNotesRef.current?.focus(), 0);
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const remove = async (product: Product) => {
    if (!permissions.canMutate) {
      setNotice("이 매장의 상품 관리 권한이 필요합니다.");
      return;
    }
    if (!token || busy || !isManageableProductStatus(product.status)) return;
    const confirmation = product.status === "active"
      ? `공개 중인 “${product.title}” 상품을 삭제할까요? 사이트에서 즉시 사라집니다. 입찰·주문 이력이 있으면 삭제되지 않습니다.`
      : `“${product.title}” 초안을 삭제할까요?`;
    if (!window.confirm(confirmation)) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/admin/operator/products/${product.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expectedUpdatedAt: product.updated_at }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "상품을 삭제하지 못했습니다.");
      setNotice("상품을 삭제했습니다."); if (editingId === product.id) resetForm(); await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const pause = async (product: Product) => {
    if (!token || busy || product.status !== "active") return;
    if (!window.confirm(`“${product.title}” 상품 공개를 일시중지할까요?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/products/${product.id}/pause`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ expectedUpdatedAt: product.updated_at }),
        },
      );
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "상품을 일시중지하지 못했습니다.");
      }
      setNotice("상품 공개를 일시중지했습니다.");
      if (editingId === product.id) resetForm();
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "상품을 일시중지하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const publish = async (product: Product) => {
    if (!token || busy || product.status !== "pending") return;
    setBusy(true);
    setNotice("");
    try {
      await publishProductNow(token, product.id);
      setNotice("상품을 공개했습니다.");
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "상품을 공개하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const togglePending = (productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (!product || !stores.some((store) => store.id === product.store_id && store.canPublish)) return;
    setSelectedPendingIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const toggleAllVisiblePending = () => {
    if (!permissions.canPublish) return;
    setSelectedPendingIds((current) => {
      const next = new Set(current);
      if (allVisiblePendingSelected) visiblePendingIds.forEach((id) => next.delete(id));
      else visiblePendingIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const publishSelected = async () => {
    if (!permissions.canPublish || !token || busy || selectedPendingIds.size === 0) return;
    const ids = [...selectedPendingIds];
    setBusy(true);
    setNotice("");
    let published = 0;
    const failedIds: string[] = [];
    try {
      for (const id of ids) {
        try {
          await publishProductNow(token, id);
          published += 1;
        } catch {
          failedIds.push(id);
        }
      }
      setSelectedPendingIds(new Set(failedIds));
      setNotice(failedIds.length > 0
        ? `${published}개 상품을 공개했고 ${failedIds.length}개는 공개되지 않아 선택 상태로 남겼습니다.`
        : `${published}개 상품을 지금 공개했습니다.`);
      await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "선택한 상품을 공개하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const importXlsx = async (
    preview: BatchAuctionPreview,
    scopedStoreId: string,
    onProgress: BatchAuctionProgressReporter,
  ) => {
    if (!token || busy || !permissions.canCreate) {
      throw new Error("상품 등록 권한과 로그인 상태를 다시 확인해 주세요.");
    }
    if (!stores.some((store) => store.id === scopedStoreId)) {
      throw new Error("현재 계정에 허용된 숍만 선택할 수 있습니다.");
    }
    if (!preview.canSubmit || preview.rows.length === 0) {
      throw new Error("검증을 통과한 엑셀 상품이 없습니다.");
    }

    const totalImages = preview.drafts.reduce(
      (total, draft) => total + draft.imageFiles.length,
      0,
    );
    const uploadedPaths: string[] = [];
    const productsToInsert: Array<Record<string, unknown>> = [];
    let completedImages = 0;
    let persisted = false;

    setBusy(true);
    setNotice("");
    try {
      onProgress(0, totalImages, "uploading");
      for (const row of preview.rows) {
        if (!row.draft) throw new Error(`${row.rowNumber}행의 검증 결과가 유효하지 않습니다.`);
        const draft = row.draft;
        const productId = crypto.randomUUID();
        const uploaded = await uploadProductImages(
          draft.imageFiles,
          productId,
          (completedForProduct) => {
            onProgress(completedImages + completedForProduct, totalImages, "uploading");
          },
        );
        completedImages += draft.imageFiles.length;
        uploadedPaths.push(...uploaded.paths);
        productsToInsert.push({
          id: productId,
          title: draft.title,
          brand: inferBrandFromTitle(draft.title).brand,
          description: draft.description,
          category: "구제 의류",
          storeId: scopedStoreId,
          saleType: draft.saleType,
          startingPrice: draft.startingPrice,
          fixedPrice: draft.fixedPrice ?? undefined,
          bidIncrement: draft.bidIncrement,
          imageUrls: uploaded.imageUrls,
          thumbnailUrls: uploaded.thumbnailUrls,
          publishAt: draft.publish_at,
          closesAt: draft.saleType === "fixed"
            ? FIXED_PRODUCT_OPEN_UNTIL
            : getNextAuctionDeadline(draft.publish_at).toISOString(),
          sizeLabel: row.size,
          conditionGrade: importedConditionGrade(row.condition),
          storageClass: "small",
          inspectionNotes: [],
        });
      }

      onProgress(totalImages, totalImages, "saving");
      const response = await fetch("/api/admin/operator/products/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ products: productsToInsert }),
      });
      const payload = await response.json().catch(() => null) as { products?: Array<{ id: string }>; count?: number; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "검증된 상품을 저장하지 못했습니다.");
      persisted = true;
      const count = payload?.count ?? productsToInsert.length;
      const canPublish = stores.find((store) => store.id === scopedStoreId)?.canPublish === true;
      const insertedIds = (payload?.products ?? []).map((product) => product.id);
      let published = 0;
      if (canPublish) {
        for (const productId of insertedIds) {
          try {
            await publishProductNow(token, productId);
            published += 1;
          } catch {
            // A failed publication remains an explicit draft and is reported below.
          }
        }
      }
      setNotice(canPublish
        ? `${published}개 엑셀 상품을 즉시 공개했습니다.${published < count ? ` ${count - published}개는 초안으로 남았습니다.` : ""}`
        : `${count}개 엑셀 상품을 초안으로 저장했습니다.`);
      try {
        await load(token);
      } catch {
        setNotice(`${count}개 엑셀 상품을 저장했습니다. 목록 새로고침이 필요합니다.`);
      }
      return count;
    } catch (error) {
      if (!persisted) await discardUnpersistedProductImages(uploadedPaths);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-8">
    <SectionHeading action={<div className="grid grid-cols-2 gap-2 sm:flex"><Button className="flex items-center justify-center gap-2" disabled={!token || !permissions.canCreate || busy} onClick={() => setXlsxImportOpen(true)} type="button"><FileSpreadsheet size={15} /> 엑셀 일괄 등록</Button><Button className="flex items-center justify-center gap-2" disabled={!token || !permissions.canCreate} variant="primary" onClick={() => { resetForm(); window.scrollTo({ top: 0, behavior: "smooth" }); }} type="button"><Plus size={15} /> 새 상품</Button></div>} description="내 숍의 판매글을 등록하고 공개 상태·상품 정보·입찰 방식을 관리합니다." eyebrow="운영자 / 상품 관리" title="상품 등록·관리" variant="page" />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    {products.some((product) => product.brand_source === "inferred" && product.status === "pending") && <StatusNotice>초안 중 제목에서 임시 추론한 브랜드가 있습니다. 수정 저장하면 확인된 브랜드로 전환됩니다.</StatusNotice>}
    {products.some((product) => product.brand_source === "inferred" && product.status === "pending") && <section className="border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold text-amber-900">브랜드 확인 필요</p><div className="mt-3 flex flex-wrap gap-2">{products.filter((product) => product.brand_source === "inferred" && product.status === "pending").map((product) => <button className="border border-amber-300 bg-paper px-3 py-2 text-left text-[11px] text-amber-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!permissions.canMutate} key={product.id} onClick={() => edit(product)} type="button"><span className="font-bold">{product.brand}</span> · {product.title}</button>)}</div></section>}
    <form className="grid grid-cols-1 gap-3 border border-ink bg-surface p-4 sm:grid-cols-2 sm:p-6" onSubmit={submit}>
      <div className="flex items-center justify-between sm:col-span-2"><p className="text-sm font-bold">{editingId ? "상품 수정" : "상품 등록"}</p>{editingId && <Button size="compact" variant="ghost" onClick={resetForm} type="button">수정 취소</Button>}</div>
      <TextInput aria-label="상품명" disabled={!productFieldsEditable} onChange={(event) => update("title", event.target.value)} placeholder="상품명" required value={form.title} />
      <TextInput aria-label="브랜드" disabled={!productFieldsEditable} onChange={(event) => update("brand", event.target.value)} placeholder="브랜드" required value={form.brand} />
      <SelectInput aria-label="숍" disabled={!saleSetupEditable} onChange={(event) => {
        const storeId = event.target.value;
        setForm((current) => ({
          ...current,
          storeId,
          status: stores.find((store) => store.id === storeId)?.canPublish === true ? current.status : "pending",
        }));
      }} required value={form.storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</SelectInput>
      <TextArea aria-label="상품 설명" className="min-h-24 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("description", event.target.value)} placeholder="상품 설명" required value={form.description} />
      <TextInput aria-label="카테고리" disabled={!productFieldsEditable} onChange={(event) => update("category", event.target.value)} placeholder="카테고리" value={form.category} />
      <TextInput aria-label="사이즈" disabled={!productFieldsEditable} onChange={(event) => update("sizeLabel", event.target.value)} placeholder="사이즈" value={form.sizeLabel} />
      <div className="flex flex-col gap-2 sm:flex-row"><SelectInput aria-label="판매 방식" className="flex-1" disabled={!saleSetupEditable} onChange={(event) => update("saleType", event.target.value)} value={form.saleType}><option value="fixed">즉시구매</option><option value="auction">경매</option></SelectInput><TextInput aria-label="가격" className="w-full sm:w-40" disabled={!saleSetupEditable} min="1" onChange={(event) => update("price", event.target.value)} placeholder="가격" required type="number" value={form.price} /></div>
      <div className="flex gap-2"><SelectInput aria-label="컨디션" className="flex-1" disabled={!productFieldsEditable} onChange={(event) => update("conditionGrade", event.target.value)} value={form.conditionGrade}><option value="S">S</option><option value="A+">A+</option><option value="A">A</option><option value="B">B</option></SelectInput><SelectInput aria-label="보관 등급" className="flex-1" disabled={!productFieldsEditable} onChange={(event) => update("storageClass", event.target.value)} value={form.storageClass}><option value="small">소형 · 14일</option><option value="large">대형 · 7일</option></SelectInput></div>
      <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-muted"><span className="mb-2 block">공개 시각</span><TextInput aria-label="공개 시각" className="w-full text-ink" disabled={!saleSetupEditable} onChange={(event) => update("publishAt", event.target.value)} type="datetime-local" value={form.publishAt} /></label>
        {form.saleType === "auction" ? <label className="text-[10px] font-bold text-muted"><span className="mb-2 block">경매 마감 시각</span><TextInput aria-label="경매 마감 시각" className="w-full text-ink" disabled={!saleSetupEditable} onChange={(event) => update("closesAt", event.target.value)} type="datetime-local" value={form.closesAt} /></label> : <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">즉시구매 상품은 구매 확정 시 마감되므로 별도 마감 시각을 사용하지 않습니다.</div>}
      </div>
      <TextArea aria-label="점검·하자 메모" className="min-h-20 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("inspectionNotes", event.target.value)} placeholder="오염·수선·사용감 등 객관적인 상태 정보를 한 줄씩 입력" ref={inspectionNotesRef} value={form.inspectionNotes} />
      <TextArea aria-label="이미지 URL" className="min-h-20 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("imageUrls", event.target.value)} placeholder="이미지 URL을 줄바꿈 또는 쉼표로 입력" required value={form.imageUrls} />
      <p className="text-[11px] leading-5 text-amber-800 sm:col-span-2">URL 등록은 원격 파일을 그대로 연결하므로 2560px 고해상도 원본과 360p 미리보기를 새로 만들지 않습니다. 로컬 원본에서 두 파생본을 보존하려면 엑셀 일괄 등록을 사용해 주세요.</p>
      <div className="flex flex-col gap-2 sm:flex-row"><TextInput aria-label="입찰 단위" disabled={!saleSetupEditable} min="1" onChange={(event) => update("bidIncrement", event.target.value)} placeholder="입찰 단위" type="number" value={form.bidIncrement} /><SelectInput aria-label="공개 상태" disabled={!saleSetupEditable} onChange={(event) => update("status", event.target.value)} value={form.status}><option value="pending">초안으로 저장</option>{(form.status === "active" || stores.find((store) => store.id === form.storeId)?.canPublish) && <option value="active">{editingProduct?.status === "active" ? "현재 공개 중" : "저장 후 즉시 공개"}</option>}</SelectInput></div>
      <div className="flex flex-wrap gap-2 sm:col-span-2"><Button className="px-5" disabled={busy || !token || !productFieldsEditable} variant="primary" type="submit">{editingId ? "수정 저장" : "등록하기"}</Button><Button className="px-5" onClick={resetForm} type="button">초기화</Button></div>
    </form>
    <div className="flex flex-col items-start justify-between gap-3 text-xs text-muted sm:flex-row sm:items-center"><span>{loading ? "상품을 불러오는 중…" : `${visibleProducts.length} / ${products.length}개 상품 · 실시간 데이터`}</span><div className="flex items-center gap-4"><button className="flex items-center gap-2 underline" disabled={loading} onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button></div></div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3"><input aria-label="상품 검색" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, search: event.target.value })} placeholder="상품명·숍 검색" value={filter.search} /><select aria-label="상품 상태 필터" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, status: event.target.value })} value={filter.status}><option value="all">전체 상태</option><option value="pending">초안</option><option value="active">공개</option><option value="closed">마감</option></select><select aria-label="판매 방식 필터" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, saleType: event.target.value })} value={filter.saleType}><option value="all">전체 판매 방식</option><option value="fixed">즉시구매</option><option value="auction">경매</option></select></div>
    <div className="flex flex-col items-start justify-between gap-3 border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center">
      <label className="flex items-center gap-3 text-xs font-bold"><input checked={allVisiblePendingSelected} disabled={busy || !permissions.canPublish || visiblePendingIds.length === 0} onChange={toggleAllVisiblePending} type="checkbox" /> 검색 결과의 초안 전체 선택</label>
      <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-xs text-muted">{selectedPendingIds.size}개 선택</span>{selectedPendingIds.size > 0 && <Button disabled={busy} onClick={() => setSelectedPendingIds(new Set())} size="compact" variant="ghost" type="button">선택 해제</Button>}<Button disabled={busy || !permissions.canPublish || selectedPendingIds.size === 0} onClick={() => void publishSelected()} size="compact" variant="primary" type="button">지금 즉시 공개</Button></div>
    </div>
    <div className="overflow-x-auto border-y border-line"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="border-b border-line bg-surface text-[10px] tracking-[.12em] text-muted"><tr><th className="px-4 py-4">선택</th><th className="px-4 py-4">상품</th><th className="px-4 py-4">숍</th><th className="px-4 py-4">판매 방식</th><th className="px-4 py-4">가격</th><th className="px-4 py-4">보관</th><th className="px-4 py-4">상태</th><th className="px-4 py-4" /></tr></thead><tbody className="divide-y divide-line">{visibleProducts.map((product) => { const manageable = isManageableProductStatus(product.status); const canPublishStore = stores.some((store) => store.id === product.store_id && store.canPublish); return <tr key={product.id}><td className="px-4 py-4"><input aria-label={`${product.title} 공개 선택`} checked={selectedPendingIds.has(product.id)} disabled={busy || !canPublishStore || product.status !== "pending"} onChange={() => togglePending(product.id)} type="checkbox" /></td><td className="px-4 py-4"><div className="flex items-center gap-3"><CatalogImage alt="" className="size-12 object-cover" src={product.image_urls?.[0] ?? ""} /><span className="font-bold">{product.title}</span></div></td><td className="px-4 py-4 text-muted">{product.stores?.name ?? "미지정"}</td><td className="px-4 py-4">{product.sale_type === "fixed" ? "즉시구매" : "경매"}</td><td className="px-4 py-4 font-mono">{(product.fixed_price ?? product.current_price).toLocaleString("ko-KR")}원</td><td className="px-4 py-4">{product.storage_class === "large" ? "대형 · 7일" : "소형 · 14일"}</td><td className="px-4 py-4"><span className="border border-line px-2 py-1 text-[10px] font-bold">{productStatusLabel(product.status)}</span></td><td className="px-4 py-4 text-right"><div className="flex justify-end gap-3">{product.status === "active" && <button aria-label={`${product.title} 일시중지`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate} onClick={() => void pause(product)} type="button"><PauseCircle size={13} /> 일시중지</button>}{product.status === "pending" && <button aria-label={`${product.title} 공개`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !canPublishStore} onClick={() => void publish(product)} type="button"><PlayCircle size={13} /> 공개</button>}<button aria-label={`${product.title} 점검`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => edit(product, "inspection")} type="button"><ClipboardCheck size={13} /> 점검</button><button aria-label={`${product.title} 수정`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => edit(product)} type="button"><Edit3 size={13} /> 수정</button><button aria-label={`${product.title} 삭제`} className="inline-flex items-center gap-1 text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => void remove(product)} type="button"><Trash2 size={13} /> 삭제</button>{product.status === "active" && <Link className="underline" href={`/auction/${product.id}`}>보기</Link>}</div></td></tr>; })}{visibleProducts.length === 0 && <tr><td className="px-4 py-16 text-center text-muted" colSpan={8}>조건에 맞는 상품이 없습니다.</td></tr>}</tbody></table></div>
    <OperatorXlsxImportModal
      onClose={() => setXlsxImportOpen(false)}
      onSubmit={importXlsx}
      open={xlsxImportOpen && permissions.canCreate}
      stores={stores}
    />
  </div>;
}
