"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, CircleStop, ClipboardCheck, Edit3, FileSpreadsheet, ImagePlus, PauseCircle, PlayCircle, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  discardUnpersistedProductImages,
  uploadProductImages,
} from "@/lib/supabase/products";
import { PRODUCT_IMAGE_INPUT_ACCEPT } from "@/lib/supabase/productImagePolicy";
import type {
  BatchAuctionPreview,
  BatchAuctionProgressReporter,
} from "@/lib/import/batchAuction";
import { inferBrandFromTitle } from "@/lib/catalog/brand";
import { BATCH_CLOTHING_CATEGORIES } from "@/lib/import/categoryIds";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextArea, TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import {
  OperatorXlsxImportModal,
  type XlsxRegistrationOptions,
} from "@/components/admin/operator/OperatorXlsxImportModal";
import { getNextAuctionDeadline } from "@/utils/formatters";
import {
  processQuickRegistrationAI,
  type ProductEnhancement,
} from "@/lib/ai/productEnhancement";

interface Store {
  id: string;
  name: string;
  canPublish: boolean;
  entitlements?: {
    aiDailyLimit: number | null;
    aiUsed: number;
    bulkImportEnabled: boolean;
    planCode: string;
    productDailyLimit: number | null;
    productsCreated: number;
  } | null;
}
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
  gender: string;
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
  gender: "" | "남성" | "여성" | "공용";
  storageClass: "small" | "large";
  status: "pending" | "active";
  bidIncrement: string;
  publishAt: string;
  closesAt: string;
  inspectionNotes: string;
};

type PublicationMode = "now" | "next-day-10";

interface SingleImage {
  file: File;
  id: string;
  previewUrl: string;
}

interface SingleRegistrationSnapshot {
  accessToken: string;
  canPublishImmediately: boolean;
  files: File[];
  form: FormState;
  id: string;
  productId: string;
  publicationMode: PublicationMode;
}

interface SingleRegistrationJob {
  id: string;
  status: "pending" | "failed";
  title: string;
}

type ProductConsoleView = "active" | "registration";
type RegistrationStage = "scheduled" | "draft";

const emptyForm: FormState = {
  title: "", description: "", brand: "", category: "기타", storeId: "", saleType: "fixed", price: "", imageUrls: "",
  sizeLabel: "", conditionGrade: "", gender: "", storageClass: "small", status: "active", bidIncrement: "1000", publishAt: "", closesAt: "",
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
function isScheduledProduct(product: Product, now: number) {
  const publishAt = new Date(product.publish_at).getTime();
  return product.status === "pending"
    && Number.isFinite(publishAt)
    && publishAt > now;
}
function requestedSingleSaleType() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("create");
  if (value === "auction") return "auction" as const;
  if (value === "fixed" || value === "single") return "fixed" as const;
  return null;
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

export function OperatorProductsConsole({
  view = "active",
}: Readonly<{ view?: ProductConsoleView }>) {
  const requestedSaleType = requestedSingleSaleType();
  const [token, setToken] = useState<string | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productReferenceNow, setProductReferenceNow] = useState(0);
  const [form, setForm] = useState<FormState>(() => ({
    ...emptyForm,
    saleType: requestedSaleType ?? "fixed",
  }));
  const [singleCreateOpen, setSingleCreateOpen] = useState(
    () => view === "registration" && requestedSaleType !== null,
  );
  const [singleImages, setSingleImages] = useState<SingleImage[]>([]);
  const [publicationMode, setPublicationMode] =
    useState<PublicationMode>("next-day-10");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUpdatedAt, setEditingUpdatedAt] = useState<string | null>(null);
  const [permissions, setPermissions] = useState({
    canCloseAuctions: false,
    canCreate: false,
    canMutate: false,
    canPublish: false,
  });
  const [filter, setFilter] = useState<{
    saleType: "all" | "fixed" | "auction";
    search: string;
  }>({
    saleType: view === "active" ? "fixed" : "all",
    search: "",
  });
  const [registrationStage, setRegistrationStage] =
    useState<RegistrationStage>("scheduled");
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(new Set());
  const [xlsxImportOpen, setXlsxImportOpen] = useState(() =>
    typeof window !== "undefined"
      && new URLSearchParams(window.location.search).get("import") === "xlsx",
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [singleRegistrationJobs, setSingleRegistrationJobs] = useState<
    SingleRegistrationJob[]
  >([]);
  const inspectionNotesRef = useRef<HTMLTextAreaElement>(null);
  const singleImagesRef = useRef<SingleImage[]>([]);
  const singleRegistrationSnapshotsRef = useRef(
    new Map<string, SingleRegistrationSnapshot>(),
  );
  const processingSingleRegistrationIdsRef = useRef(new Set<string>());
  const quickAiRequestRef = useRef<AbortController | null>(null);
  const [quickAiBusy, setQuickAiBusy] = useState(false);
  const [quickAiPreview, setQuickAiPreview] = useState<ProductEnhancement | null>(null);

  useEffect(() => {
    singleImagesRef.current = singleImages;
  }, [singleImages]);

  useEffect(
    () => () => {
      singleImagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl),
      );
    },
    [],
  );

  const pendingSingleRegistrationCount = singleRegistrationJobs.filter(
    (job) => job.status === "pending",
  ).length;
  const failedSingleRegistrations = singleRegistrationJobs.filter(
    (job) => job.status === "failed",
  );

  useEffect(() => {
    if (singleRegistrationJobs.length === 0) return;
    const confirmBackgroundWork = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmBackgroundWork);
    return () =>
      window.removeEventListener("beforeunload", confirmBackgroundWork);
  }, [singleRegistrationJobs.length]);

  const load = useCallback(async (accessToken: string | null) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const response = await fetch("/api/admin/operator/products", { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const payload = await response.json() as {
        stores?: Store[];
        products?: Product[];
        permissions?: {
          canCloseAuctions: boolean;
          canCreate: boolean;
          canMutate: boolean;
          canPublish: boolean;
        };
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? "상품을 불러오지 못했습니다.");
      const nextPermissions = payload.permissions ?? {
        canCloseAuctions: false,
        canCreate: false,
        canMutate: false,
        canPublish: false,
      };
      const nextStores = payload.stores ?? [];
      setStores(nextStores);
      setProducts(payload.products ?? []);
      setProductReferenceNow(Date.now());
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

  const workspaceProducts = useMemo(() => {
    return products.filter((product) => {
      if (view === "active") {
        return product.status === "active"
          && product.sale_type === filter.saleType;
      }
      if (product.status !== "pending") return false;
      const scheduled = isScheduledProduct(product, productReferenceNow);
      return registrationStage === "scheduled" ? scheduled : !scheduled;
    });
  }, [filter.saleType, productReferenceNow, products, registrationStage, view]);
  const visibleProducts = useMemo(() => {
    const query = filter.search.trim().toLowerCase();
    return workspaceProducts.filter((product) =>
      (!query
        || product.title.toLowerCase().includes(query)
        || product.brand.toLowerCase().includes(query)
        || (product.stores?.name ?? "").toLowerCase().includes(query))
      && (view === "active"
        || filter.saleType === "all"
        || product.sale_type === filter.saleType),
    );
  }, [filter, view, workspaceProducts]);
  const activeProductCounts = useMemo(
    () => ({
      auction: products.filter(
        (product) =>
          product.status === "active" && product.sale_type === "auction",
      ).length,
      fixed: products.filter(
        (product) =>
          product.status === "active" && product.sale_type === "fixed",
      ).length,
    }),
    [products],
  );
  const registrationCounts = useMemo(() => {
    return products.reduce(
      (counts, product) => {
        if (product.status !== "pending") return counts;
        if (isScheduledProduct(product, productReferenceNow)) {
          counts.scheduled += 1;
        }
        else counts.draft += 1;
        return counts;
      },
      { draft: 0, scheduled: 0 },
    );
  }, [productReferenceNow, products]);
  const visiblePendingIds = useMemo(
    () => permissions.canPublish
      ? visibleProducts
        .filter((product) => product.status === "pending" && stores.some((store) => store.id === product.store_id && store.canPublish))
        .map((product) => product.id)
      : [],
    [permissions.canPublish, stores, visibleProducts],
  );
  const selectedStore = stores.find((store) => store.id === form.storeId) ?? null;
  const selectedEntitlements = selectedStore?.entitlements ?? null;
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
  const clearSingleImages = () => {
    singleImagesRef.current.forEach((image) =>
      URL.revokeObjectURL(image.previewUrl),
    );
    singleImagesRef.current = [];
    setSingleImages([]);
  };
  const resetForm = () => {
    quickAiRequestRef.current?.abort();
    setQuickAiPreview(null);
    clearSingleImages();
    setEditingId(null);
    setEditingUpdatedAt(null);
    setSingleCreateOpen(false);
    setPublicationMode("next-day-10");
    setForm((current) => {
      const storeId = current.storeId || stores[0]?.id || "";
      const canPublish = stores.find((store) => store.id === storeId)?.canPublish === true;
      return { ...emptyForm, storeId, status: canPublish ? "active" : "pending" };
    });
  };

  const setBlankSingleRegistration = (
    saleType: "fixed" | "auction",
    keepOpen: boolean,
  ) => {
    quickAiRequestRef.current?.abort();
    setQuickAiPreview(null);
    clearSingleImages();
    setEditingId(null);
    setEditingUpdatedAt(null);
    setSingleCreateOpen(keepOpen);
    setForm((current) => {
      const storeId = current.storeId || stores[0]?.id || "";
      const canPublish =
        stores.find((store) => store.id === storeId)?.canPublish === true;
      return {
        ...emptyForm,
        saleType,
        storeId,
        status: canPublish ? "active" : "pending",
      };
    });
  };

  const startSingleCreate = (saleType: "fixed" | "auction") => {
    setPublicationMode("next-day-10");
    setBlankSingleRegistration(saleType, true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const prepareNextSingleRegistration = () => {
    setBlankSingleRegistration(form.saleType, true);
  };

  const addSingleImages = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    if (singleImages.length + selected.length > 15) {
      setNotice("단품 사진은 최대 15장까지 선택할 수 있습니다.");
      return;
    }
    const additions = selected.map((file) => ({
      file,
      id: crypto.randomUUID(),
      previewUrl: URL.createObjectURL(file),
    }));
    setSingleImages((current) => [...current, ...additions]);
    setNotice("");
  };

  const runQuickAi = async () => {
    if (!token || !form.storeId || singleImages.length === 0 || quickAiBusy) return;
    quickAiRequestRef.current?.abort();
    const controller = new AbortController();
    quickAiRequestRef.current = controller;
    setQuickAiBusy(true);
    setQuickAiPreview(null);
    setNotice("");
    try {
      const enhancement = await processQuickRegistrationAI(
        singleImages.slice(0, 2).map((image) => image.file),
        {
          title: form.title,
          description: form.description,
          categoryId: BATCH_CLOTHING_CATEGORIES.find((item) => item.label === form.category)?.id ?? null,
          sizeLabel: form.sizeLabel,
        },
        token,
        form.storeId,
        controller.signal,
      );
      if (!enhancement) {
        setNotice("AI 분석을 완료하지 못해 기존 입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setQuickAiPreview(enhancement);
      setNotice("AI 보정안을 만들었습니다. 변경 내용을 확인한 뒤 적용해 주세요.");
      await load(token);
    } finally {
      if (quickAiRequestRef.current === controller) {
        quickAiRequestRef.current = null;
        setQuickAiBusy(false);
      }
    }
  };

  const applyQuickAi = (fields?: ReadonlySet<keyof FormState>) => {
    if (!quickAiPreview) return;
    const shouldApply = (field: keyof FormState) => !fields || fields.has(field);
    setForm((current) => ({
      ...current,
      title: shouldApply("title") ? quickAiPreview.enhancedTitle : current.title,
      gender: shouldApply("gender") ? quickAiPreview.gender : current.gender,
      brand: shouldApply("brand") ? quickAiPreview.brand : current.brand,
      category: shouldApply("category")
        ? quickAiPreview.categoryLabel ?? current.category
        : current.category,
      sizeLabel: shouldApply("sizeLabel") ? quickAiPreview.sizeLabel : current.sizeLabel,
      description: shouldApply("description") ? quickAiPreview.refinedDescription : current.description,
    }));
    setQuickAiPreview(null);
    setNotice("선택한 AI 보정안을 입력란에 적용했습니다. 등록 전에 최종 확인해 주세요.");
  };

  const moveSingleImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= singleImages.length) return;
    setSingleImages((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeSingleImage = (id: string) => {
    setSingleImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  };

  const processSingleRegistration = async (
    snapshot: SingleRegistrationSnapshot,
  ) => {
    if (processingSingleRegistrationIdsRef.current.has(snapshot.id)) return;
    processingSingleRegistrationIdsRef.current.add(snapshot.id);
    setSingleRegistrationJobs((current) =>
      current.map((job) =>
        job.id === snapshot.id ? { ...job, status: "pending" } : job,
      ),
    );
    const uploadedPaths: string[] = [];
    let persisted = false;
    try {
      const uploaded = await uploadProductImages(
        snapshot.files,
        snapshot.productId,
      );
      uploadedPaths.push(...uploaded.paths);
      const body = {
        id: snapshot.productId,
        registrationMode: "single",
        title: snapshot.form.title,
        brand: snapshot.form.brand,
        gender: snapshot.form.gender,
        conditionGrade: snapshot.form.conditionGrade,
        description: snapshot.form.description,
        category: snapshot.form.category,
        categoryId: BATCH_CLOTHING_CATEGORIES.find((item) => item.label === snapshot.form.category)?.id ?? null,
        sizeLabel: snapshot.form.sizeLabel,
        storeId: snapshot.form.storeId,
        saleType: snapshot.form.saleType,
        startingPrice: Number(snapshot.form.price),
        fixedPrice:
          snapshot.form.saleType === "fixed"
            ? Number(snapshot.form.price)
            : undefined,
        bidIncrement: Number(snapshot.form.bidIncrement),
        storageClass: snapshot.form.storageClass,
        publicationMode: snapshot.publicationMode,
        imageUrls: uploaded.imageUrls,
        thumbnailUrls: uploaded.thumbnailUrls,
      };
      const response = await fetch("/api/admin/operator/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${snapshot.accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        product?: { id: string };
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "상품을 저장하지 못했습니다.",
        );
      }
      persisted = true;
      let message = snapshot.publicationMode === "next-day-10"
        ? `“${snapshot.form.title}” 단품 등록과 오전 10시 공개 예약을 완료했습니다.`
        : `“${snapshot.form.title}” 단품 등록을 완료했습니다.`;
      if (snapshot.canPublishImmediately) {
        if (!payload.product?.id) {
          message = `“${snapshot.form.title}” 상품은 등록했지만 즉시 공개 결과를 확인하지 못했습니다. 초안 목록을 확인해 주세요.`;
        } else {
          try {
            await publishProductNow(snapshot.accessToken, payload.product.id);
            message = `“${snapshot.form.title}” 상품을 등록하고 지금 공개했습니다.`;
          } catch (error) {
            const reason = error instanceof Error
              ? error.message
              : "즉시 공개 결과를 확인하지 못했습니다.";
            message = `“${snapshot.form.title}” 상품은 등록했지만 즉시 공개하지 못했습니다. ${reason}`;
          }
        }
      }
      singleRegistrationSnapshotsRef.current.delete(snapshot.id);
      setSingleRegistrationJobs((current) =>
        current.filter((job) => job.id !== snapshot.id),
      );
      setNotice(message);
      try {
        await load(snapshot.accessToken);
      } catch {
        setNotice(`${message} 목록은 새로고침하면 확인할 수 있습니다.`);
      }
    } catch (error) {
      if (!persisted) await discardUnpersistedProductImages(uploadedPaths);
      setSingleRegistrationJobs((current) =>
        current.map((job) =>
          job.id === snapshot.id ? { ...job, status: "failed" } : job,
        ),
      );
      const reason = error instanceof Error
        ? error.message
        : "상품을 저장하지 못했습니다.";
      setNotice(
        `“${snapshot.form.title}” 백그라운드 등록에 실패했습니다. ${reason}`,
      );
    } finally {
      processingSingleRegistrationIdsRef.current.delete(snapshot.id);
    }
  };

  const retrySingleRegistration = (jobId: string) => {
    const snapshot = singleRegistrationSnapshotsRef.current.get(jobId);
    if (!snapshot || !token) return;
    const retrySnapshot = { ...snapshot, accessToken: token };
    singleRegistrationSnapshotsRef.current.set(jobId, retrySnapshot);
    void processSingleRegistration(retrySnapshot);
  };

  const dismissFailedSingleRegistration = (jobId: string) => {
    singleRegistrationSnapshotsRef.current.delete(jobId);
    setSingleRegistrationJobs((current) =>
      current.filter((job) => job.id !== jobId),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token || busy) return;
    if (!editingId && !form.title.trim()) {
      setNotice("상품명을 입력해 주세요.");
      return;
    }
    if (!editingId && (!singleCreateOpen || singleImages.length === 0)) {
      setNotice("단품 사진을 한 장 이상 선택해 주세요.");
      return;
    }
    if (!editingId) {
      const canPublishStore =
        stores.find((store) => store.id === form.storeId)?.canPublish === true;
      const snapshot: SingleRegistrationSnapshot = {
        accessToken: token,
        canPublishImmediately: canPublishStore && publicationMode === "now",
        files: singleImages.map((image) => image.file),
        form: { ...form },
        id: crypto.randomUUID(),
        productId: crypto.randomUUID(),
        publicationMode,
      };
      singleRegistrationSnapshotsRef.current.set(snapshot.id, snapshot);
      setSingleRegistrationJobs((current) => [
        ...current,
        { id: snapshot.id, status: "pending", title: snapshot.form.title },
      ]);
      prepareNextSingleRegistration();
      setNotice(
        `“${snapshot.form.title}” 백그라운드 저장을 시작했습니다. 바로 다음 ${snapshot.form.saleType === "fixed" ? "즉시구매" : "경매"} 상품을 등록할 수 있습니다.`,
      );
      void processSingleRegistration(snapshot);
      return;
    }
    setBusy(true); setNotice("");
    try {
      if (editingId && (!permissions.canMutate || !editingProduct || !editingUpdatedAt || !isManageableProductStatus(editingProduct.status))) {
        throw new Error("수정할 상품의 최신 상태를 확인하지 못했습니다. 목록을 새로고침해 주세요.");
      }
      const canPublishStore =
        stores.find((store) => store.id === form.storeId)?.canPublish === true;
      const shouldPublishAfterSave =
        canPublishStore &&
        form.status === "active" &&
        editingProduct?.status === "pending";
      const publishAt = toIsoDateTime(form.publishAt);
      const closesAt = toIsoDateTime(form.closesAt);
      const body: Record<string, unknown> = {
        title: form.title,
        brand: form.brand,
        description: form.description,
        category: form.category,
        imageUrls: splitImages(form.imageUrls),
        sizeLabel: form.sizeLabel,
        conditionGrade: form.conditionGrade,
        storageClass: form.storageClass,
        status: shouldPublishAfterSave ? "pending" : form.status,
        expectedUpdatedAt: editingId ? editingUpdatedAt : undefined,
        ...(saleSetupEditable
          ? {
              storeId: form.storeId,
              saleType: form.saleType,
              startingPrice: Number(form.price),
              fixedPrice:
                form.saleType === "fixed" ? Number(form.price) : undefined,
              bidIncrement: Number(form.bidIncrement),
              publishAt,
              closesAt,
            }
          : {}),
        inspectionNotes: splitLines(form.inspectionNotes),
      };
      const response = await fetch(`/api/admin/operator/products/${editingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as {
        product?: { id: string };
        error?: string;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? payload.error ?? "상품을 저장하지 못했습니다.",
        );
      }
      let message = "상품 정보를 저장했습니다.";
      if (shouldPublishAfterSave) {
        if (!payload.product?.id) {
          message = "상품 정보는 저장했지만 즉시 공개 결과를 확인하지 못했습니다. 초안 목록을 확인해 주세요.";
        } else {
          try {
            await publishProductNow(token, payload.product.id);
            message = "상품 정보를 저장하고 지금 공개했습니다.";
          } catch (error) {
            const reason = error instanceof Error ? error.message : "즉시 공개 결과를 확인하지 못했습니다.";
            message = `상품 정보는 저장했지만 즉시 공개하지 못했습니다. ${reason}`;
          }
        }
      }
      setNotice(message); resetForm(); await load(token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "상품을 저장하지 못했습니다.");
    }
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
      category: product.category ?? "기타",
      storeId: product.store_id ?? stores[0]?.id ?? "",
      saleType: product.sale_type === "fixed" ? "fixed" : "auction",
      price: String(product.fixed_price ?? product.current_price),
      imageUrls: product.image_urls?.join("\n") ?? "",
      sizeLabel: product.size_label ?? "",
      conditionGrade: product.condition_grade ?? "A",
      gender:
        product.gender === "남성" ||
        product.gender === "여성" ||
        product.gender === "공용"
          ? product.gender
          : "",
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
    clearSingleImages();
    setSingleCreateOpen(false);
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

  const closeAuctionNow = async (product: Product) => {
    if (
      !token ||
      busy ||
      !permissions.canCloseAuctions ||
      product.sale_type !== "auction" ||
      product.status !== "active"
    ) {
      return;
    }
    const reason = window.prompt(
      `“${product.title}” 경매를 지금 마감합니다.\n감사 기록에 남길 사유를 입력해 주세요.`,
      "운영 테스트 즉시 마감",
    )?.trim();
    if (!reason) return;
    if (reason.length < 2 || reason.length > 500) {
      setNotice("즉시 마감 사유를 2~500자로 입력해 주세요.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/products/${product.id}/close-now`,
        {
          body: JSON.stringify({ reason }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          method: "POST",
        },
      );
      const payload = await response.json().catch(() => null) as {
        message?: string;
        result?: {
          winner_display_name?: string | null;
          winning_amount?: number | null;
        };
      } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? "경매를 즉시 마감하지 못했습니다.");
      }
      const winner = payload?.result?.winner_display_name;
      const amount = payload?.result?.winning_amount;
      setNotice(
        winner && typeof amount === "number"
          ? `경매를 즉시 마감하고 ${winner}님을 ${amount.toLocaleString("ko-KR")}원 낙찰자로 확정했습니다.`
          : "입찰자 없이 경매를 즉시 마감했습니다.",
      );
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "경매를 즉시 마감하지 못했습니다.",
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
    options: XlsxRegistrationOptions,
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
      for (const [productIndex, row] of preview.rows.entries()) {
        if (!row.draft) throw new Error(`${productIndex + 1}번째 상품의 검증 결과가 유효하지 않습니다.`);
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
          gender: row.category?.gender ?? "",
          description: draft.description,
          category: row.category?.label ?? "기타",
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
      if (canPublish && options.publicationMode === "now") {
        for (const productId of insertedIds) {
          try {
            await publishProductNow(token, productId);
            published += 1;
          } catch {
            // A failed publication remains an explicit draft and is reported below.
          }
        }
      }
      setNotice(canPublish && options.publicationMode === "now"
        ? `${published}개 엑셀 상품을 즉시 공개했습니다.${published < count ? ` ${count - published}개는 초안으로 남았습니다.` : ""}`
        : canPublish
          ? `${count}개 엑셀 상품을 다음 날 오전 10시 공개로 예약했습니다.`
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
  const singleRegistrationSubmitLabel = publicationMode === "now"
    ? `${form.saleType === "fixed" ? "즉시구매" : "경매"} 등록하고 즉시 공개`
    : `${form.saleType === "fixed" ? "즉시구매" : "경매"} 등록하고 오전 10시 예약`;
  const singleRegistrationDisabled =
    busy || !token || !productFieldsEditable || singleImages.length === 0;

  return <div className="space-y-8">
    <SectionHeading
      action={view === "registration" ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Button className="flex items-center justify-center gap-2" disabled={!token || !permissions.canCreate || busy || !stores.some((store) => store.entitlements?.bulkImportEnabled)} onClick={() => setXlsxImportOpen(true)} title={stores.some((store) => store.entitlements?.bulkImportEnabled) ? undefined : "월 5만원 등급 센터에서 사용할 수 있습니다."} type="button" variant="primary"><FileSpreadsheet size={15} /> 엑셀 일괄 등록</Button><Button className="flex items-center justify-center gap-2" disabled={!token || !permissions.canCreate} onClick={() => startSingleCreate("fixed")} type="button"><Plus size={15} /> 즉시구매 간편등록</Button><Button className="flex items-center justify-center gap-2" disabled={!token || !permissions.canCreate} onClick={() => startSingleCreate("auction")} type="button"><Plus size={15} /> 경매 간편등록</Button></div> : undefined}
      description={view === "active" ? "현재 공개 중인 상품만 판매 방식별로 나누어 관리합니다." : "신규 상품을 등록하고 업로드 예정 상품과 초안을 따로 관리합니다."}
      eyebrow={view === "active" ? "운영자 / 상품" : "운영자 / 상품 등록"}
      title={view === "active" ? "진행 중 상품" : "상품 등록"}
      variant="page"
    />
    {notice && <StatusNotice>{notice}</StatusNotice>}
    {view === "registration" && singleRegistrationJobs.length > 0 && <section aria-live="polite" className="border border-line bg-surface px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">단품 백그라운드 저장</p><p className="font-mono text-[10px] text-muted">{pendingSingleRegistrationCount > 0 ? `${pendingSingleRegistrationCount}건 처리 중` : "처리 대기 없음"}</p></div>{pendingSingleRegistrationCount > 0 && <p className="mt-2 text-[11px] text-muted">사진 처리와 저장이 진행되는 동안 간편등록칸에서 다음 상품을 계속 등록할 수 있습니다. 완료 전에는 이 페이지를 닫지 마세요.</p>}{failedSingleRegistrations.length > 0 && <div className="mt-3 space-y-2">{failedSingleRegistrations.map((job) => <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2" key={job.id}><p className="min-w-0 truncate text-[11px] font-bold text-red-700">“{job.title}” 등록 실패</p><div className="flex gap-2"><Button disabled={!token} onClick={() => retrySingleRegistration(job.id)} size="compact" type="button">다시 시도</Button><Button onClick={() => dismissFailedSingleRegistration(job.id)} size="compact" type="button" variant="ghost">닫기</Button></div></div>)}</div>}</section>}
    {view === "active" ? (
      <nav aria-label="진행 상품 판매 방식" className="grid grid-cols-2 border border-ink">
        {(["fixed", "auction"] as const).map((saleType) => <button aria-pressed={filter.saleType === saleType} className={`min-h-12 px-4 text-xs font-black ${filter.saleType === saleType ? "bg-ink text-paper" : "bg-paper text-ink"}`} key={saleType} onClick={() => setFilter((current) => ({ ...current, saleType }))} type="button">{saleType === "fixed" ? "즉시구매 상품" : "경매 상품"} <span className="ml-1 font-mono">{activeProductCounts[saleType]}</span></button>)}
      </nav>
    ) : (
      <nav aria-label="상품 등록 상태" className="grid grid-cols-2 border border-ink">
        {(["scheduled", "draft"] as const).map((stage) => <button aria-pressed={registrationStage === stage} className={`min-h-12 px-4 text-xs font-black ${registrationStage === stage ? "bg-ink text-paper" : "bg-paper text-ink"}`} key={stage} onClick={() => setRegistrationStage(stage)} type="button">{stage === "scheduled" ? "업로드 예정" : "초안"} <span className="ml-1 font-mono">{registrationCounts[stage]}</span></button>)}
      </nav>
    )}
    {view === "registration" && products.some((product) => product.brand_source === "inferred" && product.status === "pending") && <StatusNotice>초안 중 제목에서 임시 추론한 브랜드가 있습니다. 수정 저장하면 확인된 브랜드로 전환됩니다.</StatusNotice>}
    {view === "registration" && products.some((product) => product.brand_source === "inferred" && product.status === "pending") && <section className="border border-amber-200 bg-amber-50 p-4"><p className="text-xs font-bold text-amber-900">브랜드 확인 필요</p><div className="mt-3 flex flex-wrap gap-2">{products.filter((product) => product.brand_source === "inferred" && product.status === "pending").map((product) => <button className="border border-amber-300 bg-paper px-3 py-2 text-left text-[11px] text-amber-900 disabled:cursor-not-allowed disabled:opacity-40" disabled={!permissions.canMutate} key={product.id} onClick={() => edit(product)} type="button"><span className="font-bold">{product.brand}</span> · {product.title}</button>)}</div></section>}
    {(editingId || (view === "registration" && singleCreateOpen)) && (
      <form className="grid grid-cols-1 gap-3 border border-ink bg-surface p-4 sm:grid-cols-2 sm:p-6" onSubmit={submit}>
        <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold">{editingId ? "상품 수정" : form.saleType === "fixed" ? "즉시구매 간편등록" : "경매 간편등록"}</p>
            {!editingId && <p className="mt-1 text-[11px] leading-5 text-muted">{form.saleType === "auction" ? "사진을 먼저 선택하세요. 상품명은 피드에 보이는 간판글로 필수이며 성별은 선택 사항입니다." : "사진을 먼저 선택하세요. 상품명은 피드에 보이는 간판글로 필수이며 상품설명과 성별은 선택 사항입니다."}</p>}
          </div>
          {editingId ? (
            <Button className="shrink-0" size="compact" variant="ghost" onClick={resetForm} type="button">
              <X size={13} /> 수정 취소
            </Button>
          ) : (
            <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
              <Button className="px-5" disabled={singleRegistrationDisabled} size="compact" variant="primary" type="submit">
                {singleRegistrationSubmitLabel}
              </Button>
              <Button className="px-5" onClick={resetForm} size="compact" type="button">취소</Button>
            </div>
          )}
        </div>

        {!editingId && (
          <section className="border border-line bg-paper p-4 sm:col-span-2">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div><p className="text-xs font-black">1. 상품 사진 선택</p><p className="mt-1 text-[11px] text-muted">최대 15장 · 표시된 순서대로 저장{quickAiBusy ? " · AI 분석 중…" : ""}</p>{selectedEntitlements && <p className="mt-1 text-[10px] font-bold text-muted">AI {selectedEntitlements.aiUsed}/{selectedEntitlements.aiDailyLimit ?? "전체 한도"} · 상품 {selectedEntitlements.productsCreated}/{selectedEntitlements.productDailyLimit ?? "무제한"}</p>}</div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!token || !form.storeId || singleImages.length === 0 || quickAiBusy} onClick={() => void runQuickAi()} type="button" variant="primary"><Sparkles size={15} /> {quickAiBusy ? "AI 분석 중" : "AI 자동 보정"}</Button>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 border border-ink px-4 py-3 text-xs font-bold">
                  <ImagePlus size={15} /> 사진 선택
                  <input accept={PRODUCT_IMAGE_INPUT_ACCEPT} className="sr-only" multiple onChange={(event) => { addSingleImages(event.currentTarget.files); event.currentTarget.value = ""; }} type="file" />
                </label>
              </div>
            </div>
            {singleImages.length > 0 ? (
              <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {singleImages.map((image, index) => (
                  <li className="border border-line bg-surface p-2" key={image.id}>
                    <CatalogImage alt={`선택 사진 ${index + 1}`} className="aspect-square w-full object-cover" src={image.previewUrl} />
                    <p className="mt-2 truncate text-[10px] font-bold">{index + 1}. {image.file.name}</p>
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <button aria-label={`${index + 1}번 사진 앞으로 이동`} className="grid place-items-center border border-line p-2 disabled:opacity-30" disabled={index === 0} onClick={() => moveSingleImage(index, -1)} type="button"><ArrowUp size={12} /></button>
                      <button aria-label={`${index + 1}번 사진 뒤로 이동`} className="grid place-items-center border border-line p-2 disabled:opacity-30" disabled={index === singleImages.length - 1} onClick={() => moveSingleImage(index, 1)} type="button"><ArrowDown size={12} /></button>
                      <button aria-label={`${index + 1}번 사진 삭제`} className="grid place-items-center border border-red-200 p-2 text-red-700" onClick={() => removeSingleImage(image.id)} type="button"><Trash2 size={12} /></button>
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 border border-dashed border-line px-4 py-8 text-center text-xs text-muted">등록할 사진을 먼저 선택해 주세요.</p>}
            {quickAiPreview && <div className="mt-4 border border-violet-200 bg-violet-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black text-violet-950">AI 자동 보정 미리보기</p><p className="mt-1 text-[10px] text-violet-800">각 항목을 적용하거나 전체 적용한 뒤 직접 수정할 수 있습니다.</p></div><Button onClick={() => applyQuickAi()} size="compact" type="button" variant="primary">전체 적용</Button></div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {([
                  ["title", "상품명", form.title, quickAiPreview.enhancedTitle],
                  ["gender", "성별", form.gender, quickAiPreview.gender],
                  ["brand", "브랜드", form.brand, quickAiPreview.brand],
                  ["category", "카테고리", form.category, quickAiPreview.categoryLabel ?? form.category],
                  ["sizeLabel", "사이즈", form.sizeLabel, quickAiPreview.sizeLabel],
                  ["description", "설명", form.description, quickAiPreview.refinedDescription],
                ] as const).map(([field, label, before, after]) => <div className="border border-violet-200 bg-paper p-3" key={field}><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black">{label}</p><button className="text-[10px] font-bold underline" onClick={() => applyQuickAi(new Set([field]))} type="button">이 항목 적용</button></div><p className="mt-2 line-clamp-2 text-[10px] text-muted">기존: {before || "미입력"}</p><p className="mt-1 line-clamp-3 text-[11px] font-bold">제안: {after || "미입력"}</p></div>)}
              </div>
            </div>}
          </section>
        )}

        {editingId ? (
          <>
            <TextInput aria-label="상품명" disabled={!productFieldsEditable} onChange={(event) => update("title", event.target.value)} placeholder="상품명" required value={form.title} />
            <TextInput aria-label="브랜드" disabled={!productFieldsEditable} onChange={(event) => update("brand", event.target.value)} placeholder="브랜드" required value={form.brand} />
          </>
        ) : (
          <>
            <TextInput aria-label="상품명" onChange={(event) => update("title", event.target.value)} placeholder="상품명 (필수)" required value={form.title} />
            {form.saleType === "auction" ? (
              <TextInput aria-label="경매 시작가" min="1" onChange={(event) => update("price", event.target.value)} placeholder="경매 시작가" required type="number" value={form.price} />
            ) : (
            <SelectInput aria-label="성별" onChange={(event) => update("gender", event.target.value)} value={form.gender}>
              <option value="">성별 미입력</option>
              <option value="여성">여성</option>
              <option value="남성">남성</option>
              <option value="공용">공용</option>
            </SelectInput>
            )}
          </>
        )}

        {!editingId && form.saleType === "auction" && (
          <SelectInput aria-label="성별" onChange={(event) => update("gender", event.target.value)} value={form.gender}>
            <option value="">성별 미입력</option>
            <option value="여성">여성</option>
            <option value="남성">남성</option>
            <option value="공용">공용</option>
          </SelectInput>
        )}
        {!editingId && <>
          <TextInput aria-label="브랜드" onChange={(event) => update("brand", event.target.value)} placeholder="브랜드 (선택)" value={form.brand} />
          <SelectInput aria-label="카테고리" onChange={(event) => update("category", event.target.value)} value={form.category}>
            <option value="기타">카테고리 미입력</option>
            {BATCH_CLOTHING_CATEGORIES.map((category) => <option key={category.id} value={category.label}>{category.label}</option>)}
          </SelectInput>
          <TextInput aria-label="사이즈" onChange={(event) => update("sizeLabel", event.target.value)} placeholder="사이즈 (선택)" value={form.sizeLabel} />
        </>}
        <SelectInput aria-label="숍" disabled={!saleSetupEditable} onChange={(event) => {
          const storeId = event.target.value;
          setForm((current) => ({
            ...current,
            storeId,
            status: stores.find((store) => store.id === storeId)?.canPublish === true ? current.status : "pending",
          }));
        }} required value={form.storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</SelectInput>
        {editingId ? <div className="flex flex-col gap-2 sm:flex-row"><SelectInput aria-label="판매 방식" className="flex-1" disabled={!saleSetupEditable} onChange={(event) => update("saleType", event.target.value)} value={form.saleType}><option value="fixed">즉시구매</option><option value="auction">경매</option></SelectInput><TextInput aria-label="가격" className="w-full sm:w-40" disabled={!saleSetupEditable} min="1" onChange={(event) => update("price", event.target.value)} placeholder="가격" required type="number" value={form.price} /></div> : form.saleType === "fixed" ? <TextInput aria-label="즉시구매 가격" min="1" onChange={(event) => update("price", event.target.value)} placeholder="즉시구매 가격" required type="number" value={form.price} /> : null}
        <TextArea aria-label="상품 설명" className="min-h-24 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("description", event.target.value)} placeholder={editingId ? "상품 설명" : "상품 설명 (선택)"} required={Boolean(editingId)} value={form.description} />

        {editingId ? (
          <>
            <TextInput aria-label="카테고리" disabled={!productFieldsEditable} onChange={(event) => update("category", event.target.value)} placeholder="카테고리" value={form.category} />
            <TextInput aria-label="사이즈" disabled={!productFieldsEditable} onChange={(event) => update("sizeLabel", event.target.value)} placeholder="사이즈" value={form.sizeLabel} />
            <div className="flex gap-2"><SelectInput aria-label="컨디션" className="flex-1" disabled={!productFieldsEditable} onChange={(event) => update("conditionGrade", event.target.value)} value={form.conditionGrade}><option value="S">S</option><option value="A+">A+</option><option value="A">A</option><option value="B">B</option></SelectInput><SelectInput aria-label="보관 등급" className="flex-1" disabled={!productFieldsEditable} onChange={(event) => update("storageClass", event.target.value)} value={form.storageClass}><option value="small">소형 · 14일</option><option value="large">대형 · 7일</option></SelectInput></div>
            <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
              <label className="text-[10px] font-bold text-muted"><span className="mb-2 block">공개 시각</span><TextInput aria-label="공개 시각" className="w-full text-ink" disabled={!saleSetupEditable} onChange={(event) => update("publishAt", event.target.value)} type="datetime-local" value={form.publishAt} /></label>
              {form.saleType === "auction" ? <label className="text-[10px] font-bold text-muted"><span className="mb-2 block">경매 마감 시각</span><TextInput aria-label="경매 마감 시각" className="w-full text-ink" disabled={!saleSetupEditable} onChange={(event) => update("closesAt", event.target.value)} type="datetime-local" value={form.closesAt} /></label> : <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">즉시구매 상품은 구매 확정 시 마감되므로 별도 마감 시각을 사용하지 않습니다.</div>}
            </div>
            <TextArea aria-label="점검·하자 메모" className="min-h-20 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("inspectionNotes", event.target.value)} placeholder="오염·수선·사용감 등 객관적인 상태 정보를 한 줄씩 입력" ref={inspectionNotesRef} value={form.inspectionNotes} />
            <TextArea aria-label="이미지 URL" className="min-h-20 sm:col-span-2" disabled={!productFieldsEditable} onChange={(event) => update("imageUrls", event.target.value)} placeholder="이미지 URL을 줄바꿈 또는 쉼표로 입력" required value={form.imageUrls} />
            <p className="text-[11px] leading-5 text-amber-800 sm:col-span-2">기존 상품 수정 시에만 현재 이미지 URL을 유지하거나 변경할 수 있습니다.</p>
            <div className="flex flex-col gap-2 sm:flex-row"><TextInput aria-label="입찰 단위" disabled={!saleSetupEditable} min="1" onChange={(event) => update("bidIncrement", event.target.value)} placeholder="입찰 단위" type="number" value={form.bidIncrement} /><SelectInput aria-label="공개 상태" disabled={!saleSetupEditable} onChange={(event) => update("status", event.target.value)} value={form.status}><option value="pending">초안으로 저장</option>{(form.status === "active" || stores.find((store) => store.id === form.storeId)?.canPublish) && <option value="active">{editingProduct?.status === "active" ? "현재 공개 중" : "저장 후 즉시 공개"}</option>}</SelectInput></div>
          </>
        ) : (
          <>
            <SelectInput aria-label="보관 등급" onChange={(event) => update("storageClass", event.target.value)} value={form.storageClass}><option value="small">소형 · 14일 보관</option><option value="large">대형 · 7일 보관</option></SelectInput>
            {form.saleType === "auction" ? <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">입찰 최소 단위는 1,000원으로 자동 적용됩니다.</div> : <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">즉시구매 상품은 입찰 단위를 사용하지 않습니다.</div>}
            <label className="text-xs font-bold sm:col-span-2">
              공개 시각
              <SelectInput aria-label="단품 공개 시각" className="mt-2" onChange={(event) => setPublicationMode(event.target.value as PublicationMode)} value={publicationMode}>
                <option value="next-day-10">다음 날 오전 10시 공개 (기본)</option>
                <option value="now">즉시 공개</option>
              </SelectInput>
            </label>
          </>
        )}
        {editingId && <div className="flex flex-wrap gap-2 sm:col-span-2"><Button className="px-5" disabled={busy || !token || !productFieldsEditable} variant="primary" type="submit">수정 저장</Button><Button className="px-5" onClick={resetForm} type="button">수정 취소</Button></div>}
      </form>
    )}
    <div className="flex flex-col items-start justify-between gap-3 text-xs text-muted sm:flex-row sm:items-center"><span>{loading ? "상품을 불러오는 중…" : `${visibleProducts.length} / ${workspaceProducts.length}개 상품 · 실시간 데이터`}</span><div className="flex items-center gap-4"><button className="flex items-center gap-2 underline" disabled={loading} onClick={() => void load(token).catch((error) => setNotice(error instanceof Error ? error.message : "새로고침에 실패했습니다."))} type="button"><RefreshCw size={13} /> 새로고침</button></div></div>
    <div className={`grid grid-cols-1 gap-3 ${view === "registration" ? "sm:grid-cols-2" : ""}`}><input aria-label="상품 검색" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, search: event.target.value })} placeholder="상품명·숍 검색" value={filter.search} />{view === "registration" && <select aria-label="판매 방식 필터" className="border border-line bg-paper px-3 py-3 text-xs" onChange={(event) => setFilter({ ...filter, saleType: event.target.value as "all" | "fixed" | "auction" })} value={filter.saleType}><option value="all">전체 판매 방식</option><option value="fixed">즉시구매</option><option value="auction">경매</option></select>}</div>
    {view === "registration" && <div className="flex flex-col items-start justify-between gap-3 border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center">
      <label className="flex items-center gap-3 text-xs font-bold"><input checked={allVisiblePendingSelected} disabled={busy || !permissions.canPublish || visiblePendingIds.length === 0} onChange={toggleAllVisiblePending} type="checkbox" /> 검색 결과 전체 선택</label>
      <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-xs text-muted">{selectedPendingIds.size}개 선택</span>{selectedPendingIds.size > 0 && <Button disabled={busy} onClick={() => setSelectedPendingIds(new Set())} size="compact" variant="ghost" type="button">선택 해제</Button>}<Button disabled={busy || !permissions.canPublish || selectedPendingIds.size === 0} onClick={() => void publishSelected()} size="compact" variant="primary" type="button">지금 즉시 공개</Button></div>
    </div>}
    <div className="overflow-x-auto border-y border-line"><table className="w-full min-w-[1080px] text-left text-xs"><thead className="border-b border-line bg-surface text-[10px] tracking-[.12em] text-muted"><tr>{view === "registration" && <th className="px-4 py-4">선택</th>}<th className="px-4 py-4">상품</th><th className="px-4 py-4">숍</th><th className="px-4 py-4">판매 방식</th><th className="px-4 py-4">가격</th><th className="px-4 py-4">보관</th><th className="px-4 py-4">상태</th><th className="px-4 py-4" /></tr></thead><tbody className="divide-y divide-line">{visibleProducts.map((product) => { const manageable = isManageableProductStatus(product.status); const canPublishStore = stores.some((store) => store.id === product.store_id && store.canPublish); return <tr key={product.id}>{view === "registration" && <td className="px-4 py-4"><input aria-label={`${product.title} 공개 선택`} checked={selectedPendingIds.has(product.id)} disabled={busy || !canPublishStore || product.status !== "pending"} onChange={() => togglePending(product.id)} type="checkbox" /></td>}<td className="px-4 py-4"><div className="flex items-center gap-3"><CatalogImage alt="" className="size-12 object-cover" src={product.image_urls?.[0] ?? ""} /><span className="font-bold">{product.title}</span></div></td><td className="px-4 py-4 text-muted">{product.stores?.name ?? "미지정"}</td><td className="px-4 py-4">{product.sale_type === "fixed" ? "즉시구매" : "경매"}</td><td className="px-4 py-4 font-mono">{(product.fixed_price ?? product.current_price).toLocaleString("ko-KR")}원</td><td className="px-4 py-4">{product.storage_class === "large" ? "대형 · 7일" : "소형 · 14일"}</td><td className="px-4 py-4"><span className="border border-line px-2 py-1 text-[10px] font-bold">{view === "registration" && isScheduledProduct(product, productReferenceNow) ? "업로드 예정" : productStatusLabel(product.status)}</span></td><td className="px-4 py-4 text-right"><div className="flex justify-end gap-3">{permissions.canCloseAuctions && product.sale_type === "auction" && product.status === "active" && <button aria-label={`${product.title} 즉시 마감`} className="inline-flex items-center gap-1 font-bold text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy} onClick={() => void closeAuctionNow(product)} type="button"><CircleStop size={13} /> 즉시 마감·낙찰 확정</button>}{product.status === "active" && <button aria-label={`${product.title} 일시중지`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate} onClick={() => void pause(product)} type="button"><PauseCircle size={13} /> 일시중지</button>}{product.status === "pending" && <button aria-label={`${product.title} 공개`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !canPublishStore} onClick={() => void publish(product)} type="button"><PlayCircle size={13} /> 공개</button>}<button aria-label={`${product.title} 점검`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => edit(product, "inspection")} type="button"><ClipboardCheck size={13} /> 점검</button><button aria-label={`${product.title} 수정`} className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => edit(product)} type="button"><Edit3 size={13} /> 수정</button><button aria-label={`${product.title} 삭제`} className="inline-flex items-center gap-1 text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !permissions.canMutate || !manageable} onClick={() => void remove(product)} type="button"><Trash2 size={13} /> 삭제</button>{product.status === "active" && <Link className="underline" href={`/auction/${product.id}`}>보기</Link>}</div></td></tr>; })}{visibleProducts.length === 0 && <tr><td className="px-4 py-16 text-center text-muted" colSpan={view === "registration" ? 8 : 7}>조건에 맞는 상품이 없습니다.</td></tr>}</tbody></table></div>
    <OperatorXlsxImportModal
      accessToken={token ?? ""}
      onClose={() => setXlsxImportOpen(false)}
      onSubmit={importXlsx}
      open={view === "registration" && xlsxImportOpen && permissions.canCreate}
      stores={stores}
    />
  </div>;
}
