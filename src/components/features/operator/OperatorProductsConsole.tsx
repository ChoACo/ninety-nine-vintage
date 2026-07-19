"use client";

import Link from "next/link";
import { Download, Edit3, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { CatalogImage } from "@/components/ui/CatalogImage";

interface Store { id: string; name: string; }
interface Product {
  id: string;
  title: string;
  description: string;
  sale_type: string;
  fixed_price: number | null;
  current_price: number;
  starting_price: number;
  status: string;
  image_urls: string[];
  store_id: string | null;
  size_label: string;
  condition_grade: string;
  storage_class: string;
  updated_at: string;
  stores?: { name: string } | null;
}
type FormState = {
  title: string;
  description: string;
  category: string;
  storeId: string;
  saleType: "fixed" | "auction";
  price: string;
  imageUrls: string;
  sizeLabel: string;
  conditionGrade: string;
  storageClass: "small" | "large";
  status: "pending" | "active" | "closed";
  bidIncrement: string;
  publishAt: string;
  closesAt: string;
};

const emptyForm: FormState = {
  title: "", description: "", category: "구제 의류", storeId: "", saleType: "fixed", price: "", imageUrls: "",
  sizeLabel: "", conditionGrade: "A", storageClass: "small", status: "pending", bidIncrement: "1000", publishAt: "", closesAt: "",
};

function splitImages(value: string) { return value.split(/[\n,|]/).map((item) => item.trim()).filter((item) => item.startsWith("http")); }
function parseCsvLine(line: string) {
  const cells: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseBulkCsv(value: string) {
  const lines = value.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("헤더와 상품 행을 함께 입력해 주세요.");
  const headers = parseCsvLine(lines[0]).map((item) => item.trim());
  if (!headers.includes("title") || !headers.includes("storeId") || !headers.includes("imageUrls")) throw new Error("title, storeId, imageUrls 헤더가 필요합니다.");
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    return {
      ...row,
      startingPrice: Number(row.startingPrice || row.price),
      fixedPrice: row.saleType === "fixed" ? Number(row.fixedPrice || row.startingPrice || row.price) : undefined,
      imageUrls: String(row.imageUrls).split(/[|;]/).map((item) => item.trim()).filter(Boolean),
      bidIncrement: Number(row.bidIncrement || 1000),
      inspectionNotes: row.inspectionNotes ? String(row.inspectionNotes).split("|").map((item) => item.trim()).filter(Boolean) : [],
    };
  });
}

export function OperatorProductsConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState("title,description,storeId,saleType,startingPrice,imageUrls,sizeLabel,conditionGrade,storageClass\n예시 상품,상세 설명,스토어 UUID,fixed,25900,https://example.com/image.jpg,M,A,small");
  const [filter, setFilter] = useState({ search: "", status: "all", saleType: "all" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    const response = await fetch("/api/operator/products", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const payload = await response.json() as { stores?: Store[]; products?: Product[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "상품을 불러오지 못했습니다.");
    setStores(payload.stores ?? []);
    setProducts(payload.products ?? []);
    setForm((current) => ({ ...current, storeId: current.storeId || payload.stores?.[0]?.id || "" }));
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
    return (!query || product.title.toLowerCase().includes(query) || (product.stores?.name ?? "").toLowerCase().includes(query))
      && (filter.status === "all" || product.status === filter.status)
      && (filter.saleType === "all" || product.sale_type === filter.saleType);
  }), [filter, products]);

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const resetForm = () => { setEditingId(null); setForm((current) => ({ ...emptyForm, storeId: current.storeId || stores[0]?.id || "" })); };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true); setNotice("");
    try {
      const body = {
        title: form.title, description: form.description, category: form.category, storeId: form.storeId, saleType: form.saleType,
        startingPrice: Number(form.price), fixedPrice: form.saleType === "fixed" ? Number(form.price) : undefined,
        imageUrls: splitImages(form.imageUrls), sizeLabel: form.sizeLabel, conditionGrade: form.conditionGrade,
        storageClass: form.storageClass, status: form.status, bidIncrement: Number(form.bidIncrement), publishAt: form.publishAt || undefined, closesAt: form.closesAt || undefined,
      };
      const response = await fetch(editingId ? `/api/operator/products/${editingId}` : "/api/operator/products", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "상품을 저장하지 못했습니다.");
      setNotice(editingId ? "상품 정보를 저장했습니다." : "상품을 등록했습니다."); resetForm(); await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const edit = (product: Product) => {
    setEditingId(product.id);
    setForm({ title: product.title, description: product.description ?? "", category: "구제 의류", storeId: product.store_id ?? stores[0]?.id ?? "", saleType: product.sale_type === "fixed" ? "fixed" : "auction", price: String(product.fixed_price ?? product.current_price), imageUrls: product.image_urls?.join("\n") ?? "", sizeLabel: product.size_label ?? "", conditionGrade: product.condition_grade ?? "A", storageClass: product.storage_class === "large" ? "large" : "small", status: ["pending", "active", "closed"].includes(product.status) ? product.status as FormState["status"] : "pending", bidIncrement: "1000", publishAt: "", closesAt: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (product: Product) => {
    if (!token || busy || !window.confirm(`“${product.title}” 상품을 삭제할까요? 주문·입찰 이력이 있으면 삭제되지 않을 수 있습니다.`)) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/operator/products/${product.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "상품을 삭제하지 못했습니다.");
      setNotice("상품을 삭제했습니다."); if (editingId === product.id) resetForm(); await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "상품을 삭제하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const bulk = async () => {
    if (!token || busy) return;
    setBusy(true); setNotice("");
    try {
      const productsToInsert = parseBulkCsv(bulkText);
      const response = await fetch("/api/operator/products/bulk", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ products: productsToInsert }) });
      const payload = await response.json() as { count?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "일괄등록에 실패했습니다.");
      setNotice(`${payload.count ?? 0}개 상품을 일괄등록했습니다.`); await load(token);
    } catch (error) { setNotice(error instanceof Error ? error.message : "CSV 형식을 확인해 주세요."); }
    finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const blob = new Blob([bulkText], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "ninety-nine-products-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return <div className="space-y-8">
    <div className="flex items-end justify-between border-b border-ink pb-6"><div><p className="eyebrow text-muted">OPERATOR / PRODUCT MANAGEMENT</p><h1 className="mt-3 text-4xl font-black tracking-[-.08em]">상품 등록·관리</h1><p className="mt-3 text-sm text-muted">내 숍의 판매글을 등록하고 공개 상태·상품 정보·입찰 방식을 관리합니다.</p></div><button className="flex items-center gap-2 bg-ink px-4 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={!token} onClick={() => { resetForm(); window.scrollTo({ top: 0, behavior: "smooth" }); }} type="button"><Plus size={15} /> 새 상품</button></div>
    {notice && <div aria-live="polite" className="border border-line bg-surface px-4 py-3 text-xs">{notice}</div>}
    <form className="grid grid-cols-2 gap-3 border border-ink bg-surface p-6" onSubmit={submit}><div className="col-span-2 flex items-center justify-between"><p className="text-sm font-bold">{editingId ? "상품 수정" : "상품 등록"}</p>{editingId && <button className="text-xs underline" onClick={resetForm} type="button">수정 취소</button>}</div><input aria-label="상품명" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("title", event.target.value)} placeholder="상품명" required value={form.title} /><select aria-label="숍" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("storeId", event.target.value)} required value={form.storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select><textarea aria-label="상품 설명" className="col-span-2 min-h-24 border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("description", event.target.value)} placeholder="상품 설명" required value={form.description} /><input aria-label="카테고리" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("category", event.target.value)} placeholder="카테고리" value={form.category} /><input aria-label="사이즈" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("sizeLabel", event.target.value)} placeholder="사이즈·실측 요약" value={form.sizeLabel} /><div className="flex gap-2"><select aria-label="판매 방식" className="flex-1 border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("saleType", event.target.value)} value={form.saleType}><option value="fixed">즉시구매</option><option value="auction">경매</option></select><input aria-label="가격" className="w-40 border border-line bg-paper px-3 py-3 text-xs" min="1" onChange={(event) => update("price", event.target.value)} placeholder="가격" required type="number" value={form.price} /></div><div className="flex gap-2"><select aria-label="컨디션" className="flex-1 border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("conditionGrade", event.target.value)} value={form.conditionGrade}><option value="S">S</option><option value="A+">A+</option><option value="A">A</option><option value="B">B</option></select><select aria-label="보관 등급" className="flex-1 border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("storageClass", event.target.value)} value={form.storageClass}><option value="small">소형 · 14일</option><option value="large">대형 · 7일</option></select></div><textarea aria-label="이미지 URL" className="col-span-2 min-h-20 border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("imageUrls", event.target.value)} placeholder="이미지 URL을 줄바꿈 또는 쉼표로 입력" required value={form.imageUrls} /><div className="flex gap-2"><input aria-label="입찰 단위" className="border border-line bg-paper px-3 py-3 text-xs" min="1" onChange={(event) => update("bidIncrement", event.target.value)} placeholder="입찰 단위" type="number" value={form.bidIncrement} /><select aria-label="상태" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => update("status", event.target.value)} value={form.status}><option value="pending">공개 대기</option><option value="active">공개</option><option value="closed">마감</option></select></div><div className="col-span-2 flex gap-2"><button className="bg-ink px-5 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || !token} type="submit">{editingId ? "수정 저장" : "등록하기"}</button><button className="border border-line px-5 py-3 text-xs font-bold" onClick={resetForm} type="button">초기화</button></div></form>
    <section className="border border-line bg-surface p-6"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Upload size={15} /><div><p className="text-sm font-bold">상품 일괄등록</p><p className="mt-1 text-[11px] text-muted">CSV 헤더: title, description, storeId, saleType, startingPrice, imageUrls. 이미지 URL은 | 로 구분합니다.</p></div></div><button className="flex items-center gap-2 text-xs underline" onClick={downloadTemplate} type="button"><Download size={13} /> 템플릿 저장</button></div><textarea aria-label="일괄등록 CSV" className="mt-4 min-h-32 w-full border border-line bg-paper p-3 font-mono text-[11px]" onChange={(event) => setBulkText(event.target.value)} value={bulkText} /><button className="mt-3 bg-ink px-5 py-3 text-xs font-bold text-paper disabled:opacity-40" disabled={busy || !token} onClick={() => void bulk()} type="button">CSV 일괄등록 실행</button></section>
    <div className="flex items-center justify-between text-xs text-muted"><span>{visibleProducts.length} / {products.length} PRODUCTS · LIVE DATABASE</span><div className="flex items-center gap-4"><button className="flex items-center gap-2 underline" onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button></div></div>
    <div className="grid grid-cols-3 gap-3"><input aria-label="상품 검색" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, search: event.target.value })} placeholder="상품명·숍 검색" value={filter.search} /><select aria-label="상품 상태 필터" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, status: event.target.value })} value={filter.status}><option value="all">전체 상태</option><option value="pending">공개 대기</option><option value="active">공개</option><option value="closed">마감</option></select><select aria-label="판매 방식 필터" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, saleType: event.target.value })} value={filter.saleType}><option value="all">전체 판매 방식</option><option value="fixed">즉시구매</option><option value="auction">경매</option></select></div>
    <div className="overflow-x-auto border-y border-line"><table className="w-full min-w-[1060px] text-left text-xs"><thead className="border-b border-line bg-surface text-[10px] uppercase tracking-[.12em] text-muted"><tr><th className="px-4 py-4">상품</th><th className="px-4 py-4">숍</th><th className="px-4 py-4">판매 방식</th><th className="px-4 py-4">가격</th><th className="px-4 py-4">보관</th><th className="px-4 py-4">상태</th><th className="px-4 py-4" /></tr></thead><tbody className="divide-y divide-line">{visibleProducts.map((product) => <tr key={product.id}><td className="px-4 py-4"><div className="flex items-center gap-3"><CatalogImage alt="" className="size-12 object-cover" src={product.image_urls?.[0] ?? ""} /><span className="font-bold">{product.title}</span></div></td><td className="px-4 py-4 text-muted">{product.stores?.name ?? "미지정"}</td><td className="px-4 py-4">{product.sale_type === "fixed" ? "BUY NOW" : "AUCTION"}</td><td className="px-4 py-4 font-mono">{(product.fixed_price ?? product.current_price).toLocaleString("ko-KR")}원</td><td className="px-4 py-4">{product.storage_class === "large" ? "대형 · 7일" : "소형 · 14일"}</td><td className="px-4 py-4"><span className="border border-line px-2 py-1 text-[10px] font-bold">{product.status}</span></td><td className="px-4 py-4 text-right"><div className="flex justify-end gap-3"><button aria-label={`${product.title} 수정`} className="inline-flex items-center gap-1 underline" onClick={() => edit(product)} type="button"><Edit3 size={13} /> 수정</button><button aria-label={`${product.title} 삭제`} className="inline-flex items-center gap-1 text-red-700 underline" disabled={busy} onClick={() => void remove(product)} type="button"><Trash2 size={13} /> 삭제</button>{product.status === "active" && <Link className="underline" href={`/auction/${product.id}`}>보기</Link>}</div></td></tr>)}{visibleProducts.length === 0 && <tr><td className="px-4 py-16 text-center text-muted" colSpan={7}>조건에 맞는 상품이 없습니다.</td></tr>}</tbody></table></div>
  </div>;
}
