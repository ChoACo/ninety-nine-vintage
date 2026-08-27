"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ChevronDown,
  Edit3,
  FileSpreadsheet,
  ImagePlus,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useOperatorStoreScope } from "@/store/useOperatorStoreScope";
import { useOperatorOptimisticStore } from "@/store/useOperatorOptimisticStore";
import { useToastStore } from "@/store/useToastStore";
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
import { isConditionGrade } from "@/lib/catalog/conditions";
import { BATCH_CLOTHING_CATEGORIES } from "@/lib/import/categoryIds";
import { DEFECT_TAGS } from "@/lib/catalog/defects";
import {
  collectMeasurements,
  MEASUREMENT_LABELS,
  measurementPresetForCategory,
} from "@/lib/catalog/measurements";
import { CatalogImage } from "@/components/ui/CatalogImage";
import { Button } from "@/components/ui/Button";
import { PremiumDialog } from "@/components/ui/PremiumDialog";
import { SelectInput, TextArea, TextInput } from "@/components/ui/FormControls";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusNotice } from "@/components/ui/StatusNotice";
import {
  OperatorXlsxImportModal,
  type XlsxRegistrationOptions,
} from "@/components/admin/operator/OperatorXlsxImportModal";
import { getNextAuctionDeadline } from "@/utils/formatters";
import { getKoreanAuctionTime } from "@/utils/auctionBidPolicy";
import {
  isAiEnhancementApplied,
  processQuickRegistrationAI,
  type ProductEnhancement,
} from "@/lib/ai/productEnhancement";
import {
  GenderCategorySelect,
  type RegistrationGender,
  CATEGORY_MAP,
} from "@/components/admin/operator/GenderCategorySelect";
import {
  getAvailablePublishSlots,
  parseBrandAndSizeFromTitle,
} from "@/lib/utils/productParser";

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
    immediateDailyLimit?: number;
    immediatePublished?: number;
    scheduledDailyLimit?: number;
    scheduledPublished?: number;
    monthlyPublicationLimit?: number;
    monthlyPublished?: number;
    pendingInventoryLimit?: number;
    pendingInventoryUsed?: number;
    automationRollingLimit?: number;
    automationRollingUsed?: number;
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
  pending_lock_kind?: "buy_now_payment" | "auction_payment" | null;
  pending_lock_until?: string | null;
  image_urls: string[];
  store_id: string | null;
  size_label: string;
  condition_grade: string;
  gender: string;
  storage_class: string;
  publish_at: string;
  paused_at?: string | null;
  closes_at: string;
  inspection_notes: string[];
  defect_tags: string[];
  measurements?: Record<string, unknown> | null;
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
  defectTags: string[];
  measurements: Record<string, string>;
};

type PublicationMode = "now" | "scheduled";

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
  publishAt: string;
  scheduledHourKst: number;
}

interface SingleRegistrationJob {
  id: string;
  status: "pending" | "failed";
  title: string;
}

type RegistrationResultModal =
  | { jobId: string; kind: "failure"; title: string }
  | { jobId: string; kind: "retrying"; title: string }
  | { jobId: string; kind: "success"; title: string }
  | null;

type ProductConsoleView = "active" | "auction" | "registration";
type RegistrationStage = "scheduled" | "draft";

const emptyForm: FormState = {
  title: "",
  description: "",
  brand: "",
  category: "남성 아우터",
  storeId: "",
  saleType: "fixed",
  price: "",
  imageUrls: "",
  sizeLabel: "",
  conditionGrade: "A",
  gender: "",
  storageClass: "small",
  status: "active",
  bidIncrement: "1000",
  publishAt: "",
  closesAt: "",
  inspectionNotes: "",
  defectTags: [],
  measurements: {},
};

function measurementFieldsFor(category: string) {
  return measurementPresetForCategory(category)?.fields ?? [];
}

function registrationGender(form: FormState): RegistrationGender {
  if (CATEGORY_MAP.ACCESSORY.some((category) => category === form.category)) {
    return "잡화/액세서리";
  }
  if (form.gender === "여성") return "여성";
  if (form.gender === "공용") return "남녀공용";
  return "남성";
}
function measurementStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        (entry): entry is [string, number | string] =>
          typeof entry[1] === "number" || typeof entry[1] === "string",
      )
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function MeasurementFields({
  category,
  disabled,
  onChange,
  values,
}: {
  category: string;
  disabled?: boolean;
  onChange: (key: string, value: string) => void;
  values: Record<string, string>;
}) {
  const preset = measurementPresetForCategory(category);
  const fields = preset?.fields ?? [];
  if (!preset || fields.length === 0) return null;
  return (
    <fieldset className="border border-line bg-surface p-3 sm:col-span-2 sm:p-4">
      <legend className="px-1 text-xs font-black">
        {preset.label} <span className="font-mono text-[10px] text-muted">CM</span>
      </legend>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        선택한 카테고리에 맞춘 항목입니다. 측정한 값만 입력해 주세요.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {fields.map((field) => (
          <label className="text-[10px] font-bold text-muted" key={field}>
            {MEASUREMENT_LABELS[field]}
            <TextInput
              aria-label={`${MEASUREMENT_LABELS[field]} 실측 (cm)`}
              className="mt-1 w-full font-mono"
              disabled={disabled}
              inputMode="decimal"
              max="500"
              min="1"
              onChange={(event) => onChange(field, event.target.value)}
              placeholder="0"
              step="0.1"
              type="number"
              value={values[field] ?? ""}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const FIXED_PRODUCT_OPEN_UNTIL = "9999-12-31T23:59:59.000Z";

function splitImages(value: string) {
  return value
    .split(/[\n,|]/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("http"));
}
function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
function toLocalDateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function importedConditionGrade(condition: string | null) {
  return condition && isConditionGrade(condition) ? condition : "A";
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let firstError: unknown = null;
  const runners = Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      while (nextIndex < values.length && !firstError) {
        const index = nextIndex++;
        try {
          results[index] = await worker(values[index], index);
        } catch (error) {
          firstError ??= error;
        }
      }
    },
  );
  await Promise.all(runners);
  if (firstError) throw firstError;
  return results;
}
function productStatusLabel(status: string) {
  if (status === "pending") return "공개 처리 중";
  if (status === "active") return "공개 중";
  if (status === "closed") return "마감";
  if (status === "sold") return "판매 완료";
  return status;
}
function productPendingLockLabel(kind: string | null | undefined) {
  if (kind === "buy_now_payment") return "결제 진행 중";
  if (kind === "auction_payment") return "낙찰 대기";
  return null;
}
function productStatusText(product: Product) {
  const lockLabel = productPendingLockLabel(product.pending_lock_kind);
  if (product.status === "closed" && lockLabel) return lockLabel;
  return productStatusLabel(product.status);
}
function isManageableProductStatus(status: string) {
  return status === "pending" || status === "active";
}
function isScheduledProduct(product: Product) {
  const publishAt = new Date(product.publish_at).getTime();
  return (
    product.status === "pending" &&
    !product.paused_at &&
    Number.isFinite(publishAt) &&
    publishAt > 0
  );
}
function isOverdueScheduledProduct(product: Product, now: number) {
  return (
    isScheduledProduct(product) &&
    new Date(product.publish_at).getTime() <= now
  );
}
function formatScheduledPublishAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "시각 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}
function requestedSingleSaleType() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("type") ?? params.get("create");
  if (value === "auction") return "auction" as const;
  if (value === "shop" || value === "fixed" || value === "single")
    return "fixed" as const;
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
  const response = await fetch(
    `/api/admin/operator/products/${productId}/publish`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const payload = (await response.json().catch(() => null)) as {
    result?: PublishPendingResult;
    error?: string;
  } | null;
  if (!response.ok)
    throw new Error(payload?.error ?? "상품을 공개하지 못했습니다.");

  const result = payload?.result;
  const published =
    result?.requested_count === 1 &&
    result.published_count === 1 &&
    result.skipped_count === 0 &&
    result.published_ids.includes(productId) &&
    !result.skipped_ids.includes(productId);
  if (!published) throw new Error("상품 공개 결과를 확인하지 못했습니다.");
  return result;
}

export function OperatorProductsConsole({
  view = "active",
}: Readonly<{ view?: ProductConsoleView }>) {
  const requestedSaleType = requestedSingleSaleType();
  const router = useRouter();
  const pushToast = useToastStore((state) => state.pushToast);
  const storeScope = useOperatorStoreScope((state) => state.scope);
  const setOptimisticProductStatus = useOperatorOptimisticStore(
    (state) => state.setProductStatus,
  );
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
  const [defectSeverities, setDefectSeverities] = useState<
    Record<string, "경미" | "보통" | "심함">
  >({});
  const publishSlots = useMemo(() => getAvailablePublishSlots(), []);
  const [publicationMode, setPublicationMode] =
    useState<PublicationMode>("scheduled");
  const [scheduledPublishAt, setScheduledPublishAt] = useState(
    () => getAvailablePublishSlots()[0]?.value ?? new Date().toISOString(),
  );
  const [scheduledHourKst, setScheduledHourKst] = useState(10);
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
    saleType:
      view === "active" ? "fixed" : view === "auction" ? "auction" : "all",
    search: "",
  });
  const [registrationStage] = useState<RegistrationStage>("scheduled");
  const [selectedPendingIds, setSelectedPendingIds] = useState<Set<string>>(
    new Set(),
  );
  const [xlsxImportOpen, setXlsxImportOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("import") === "xlsx",
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [singleRegistrationJobs, setSingleRegistrationJobs] = useState<
    SingleRegistrationJob[]
  >([]);
  const [registrationResult, setRegistrationResult] =
    useState<RegistrationResultModal>(null);
  const inspectionNotesRef = useRef<HTMLTextAreaElement>(null);
  const singleImagesRef = useRef<SingleImage[]>([]);
  const singleRegistrationSnapshotsRef = useRef(
    new Map<string, SingleRegistrationSnapshot>(),
  );
  const processingSingleRegistrationIdsRef = useRef(new Set<string>());
  const quickAiRequestRef = useRef<AbortController | null>(null);
  const [quickAiBusy, setQuickAiBusy] = useState(false);
  const [quickAiPreview, setQuickAiPreview] =
    useState<ProductEnhancement | null>(null);

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
      const response = await fetch("/api/admin/operator/products", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        stores?: Store[];
        products?: Product[];
        serverNow?: string;
        permissions?: {
          canCloseAuctions: boolean;
          canCreate: boolean;
          canMutate: boolean;
          canPublish: boolean;
        };
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "상품을 불러오지 못했습니다.");
      const nextPermissions = payload.permissions ?? {
        canCloseAuctions: false,
        canCreate: false,
        canMutate: false,
        canPublish: false,
      };
      const nextStores = payload.stores ?? [];
      setStores(nextStores);
      setProducts(payload.products ?? []);
      const serverNow = Date.parse(payload.serverNow ?? "");
      setProductReferenceNow(Number.isFinite(serverNow) ? serverNow : Date.now());
      setPermissions(nextPermissions);
      const publishableStoreIds = new Set(
        nextStores.filter((store) => store.canPublish).map((store) => store.id),
      );
      const pendingIds = new Set(
        (payload.products ?? [])
          .filter(
            (product) =>
              product.status === "pending" &&
              product.store_id !== null &&
              publishableStoreIds.has(product.store_id),
          )
          .map((product) => product.id),
      );
      setSelectedPendingIds((current) =>
        nextPermissions.canPublish
          ? new Set([...current].filter((id) => pendingIds.has(id)))
          : new Set(),
      );
      setForm((current) => {
        const storeId = current.storeId || nextStores[0]?.id || "";
        const canPublish =
          nextStores.find((store) => store.id === storeId)?.canPublish === true;
        return {
          ...current,
          storeId,
          status: current.title
            ? canPublish
              ? current.status
              : "pending"
            : canPublish
              ? "active"
              : "pending",
        };
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = (await getSupabaseBrowserClient().auth.getSession())
          .data.session;
        setToken(session?.access_token ?? null);
        if (session) {
          await load(session.access_token);
          const preferenceResponse = await fetch(
            "/api/admin/operator/products/publication-preference",
            {
              headers: { Authorization: `Bearer ${session.access_token}` },
              cache: "no-store",
            },
          );
          if (preferenceResponse.ok) {
            const payload = (await preferenceResponse.json()) as {
              preference?: {
                publicationMode?: PublicationMode;
                scheduledHourKst?: number;
              };
            };
            if (Number.isInteger(payload.preference?.scheduledHourKst))
              setScheduledHourKst(payload.preference!.scheduledHourKst!);
          }
        }
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "운영자 데이터를 불러오지 못했습니다.",
        );
      }
    })();
  }, [load]);

  useEffect(() => {
    if (!token || !storeScope.active || !storeScope.storeId) return;
    void (async () => {
      try {
        await load(token);
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "선택한 센터의 상품을 불러오지 못했습니다.",
        );
      }
    })();
  }, [load, storeScope.active, storeScope.storeId, token]);

  const workspaceProducts = useMemo(() => {
    const scopedStoreId = storeScope.active ? storeScope.storeId : null;
    return products.filter((product) => {
      if (scopedStoreId !== null && product.store_id !== scopedStoreId) {
        return false;
      }
      if (view === "active") {
        return (
          (product.status === "active" ||
            (product.status === "closed" &&
              Boolean(product.pending_lock_kind))) &&
          product.sale_type === filter.saleType
        );
      }
      if (product.status !== "pending") return false;
      const scheduled = isScheduledProduct(product);
      return registrationStage === "scheduled" ? scheduled : !scheduled;
    });
  }, [
    filter.saleType,
    products,
    registrationStage,
    storeScope,
    view,
  ]);
  const visibleProducts = useMemo(() => {
    const query = filter.search.trim().toLowerCase();
    return workspaceProducts.filter(
      (product) =>
        (!query ||
          product.title.toLowerCase().includes(query) ||
          product.brand.toLowerCase().includes(query) ||
          (product.stores?.name ?? "").toLowerCase().includes(query)) &&
        (view === "active" ||
          filter.saleType === "all" ||
          product.sale_type === filter.saleType),
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
        if (isScheduledProduct(product)) {
          counts.scheduled += 1;
        } else counts.draft += 1;
        return counts;
      },
      { draft: 0, scheduled: 0 },
    );
  }, [products]);
  const overdueScheduledCount = useMemo(
    () =>
      products.filter((product) =>
        isOverdueScheduledProduct(product, productReferenceNow),
      ).length,
    [productReferenceNow, products],
  );
  const visiblePendingIds = useMemo(
    () =>
      permissions.canPublish
        ? visibleProducts
            .filter(
              (product) =>
                product.status === "pending" &&
                stores.some(
                  (store) => store.id === product.store_id && store.canPublish,
                ),
            )
            .map((product) => product.id)
        : [],
    [permissions.canPublish, stores, visibleProducts],
  );
  const selectedStore =
    stores.find((store) => store.id === form.storeId) ?? null;
  const selectedEntitlements = selectedStore?.entitlements ?? null;
  const allVisiblePendingSelected =
    visiblePendingIds.length > 0 &&
    visiblePendingIds.every((id) => selectedPendingIds.has(id));
  const editingProduct = useMemo(
    () =>
      editingId
        ? products.find((product) => product.id === editingId)
        : undefined,
    [editingId, products],
  );
  const productFieldsEditable = editingId
    ? permissions.canMutate &&
      Boolean(
        editingProduct && isManageableProductStatus(editingProduct.status),
      )
    : permissions.canCreate;
  const saleSetupEditable = editingId
    ? permissions.canMutate && editingProduct?.status === "pending"
    : permissions.canCreate;

  const update = (key: keyof FormState, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const updateTitle = (title: string) => {
    const parsed = parseBrandAndSizeFromTitle(title);
    setForm((current) => ({
      ...current,
      title,
      brand: parsed.brand ?? "",
      sizeLabel: parsed.size ?? "",
    }));
  };
  const updateCategory = (category: string) =>
    setForm((current) => {
      const allowed: Set<string> = new Set(measurementFieldsFor(category));
      const measurements = Object.fromEntries(
        Object.entries(current.measurements).filter(([key]) =>
          allowed.has(key),
        ),
      );
      return { ...current, category, measurements };
    });
  const updateMeasurement = (key: string, value: string) =>
    setForm((current) => ({
      ...current,
      measurements: { ...current.measurements, [key]: value },
    }));
  const toggleDefect = (code: string) => {
    const removing = form.defectTags.includes(code);
    if (removing)
      setDefectSeverities((values) =>
        Object.fromEntries(
          Object.entries(values).filter(([key]) => key !== code),
        ),
      );
    setForm((current) => ({
      ...current,
      defectTags: removing
        ? current.defectTags.filter((item) => item !== code)
        : [...current.defectTags, code],
      inspectionNotes: removing
        ? current.inspectionNotes
            .split("\n")
            .filter((line) => !line.startsWith(`[하자:${code}]`))
            .join("\n")
        : current.inspectionNotes,
    }));
  };
  const scopedStores = useMemo(() => {
    if (storeScope.active && storeScope.storeId) {
      const scoped = stores.filter((store) => store.id === storeScope.storeId);
      return scoped;
    }
    return [];
  }, [storeScope, stores]);
  const clearSingleImages = useCallback(() => {
    singleImagesRef.current.forEach((image) =>
      URL.revokeObjectURL(image.previewUrl),
    );
    singleImagesRef.current = [];
    setSingleImages([]);
    setDefectSeverities({});
  }, []);
  const resetForm = useCallback(() => {
    quickAiRequestRef.current?.abort();
    setQuickAiPreview(null);
    clearSingleImages();
    setEditingId(null);
    setEditingUpdatedAt(null);
    setSingleCreateOpen(false);
    setPublicationMode("scheduled");
    setScheduledPublishAt(publishSlots[0]?.value ?? new Date().toISOString());
    setForm((current) => {
      const storeId = current.storeId || scopedStores[0]?.id || "";
      const canPublish =
        scopedStores.find((store) => store.id === storeId)?.canPublish === true;
      return {
        ...emptyForm,
        storeId,
        status: canPublish ? "active" : "pending",
      };
    });
  }, [clearSingleImages, publishSlots, scopedStores]);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        const formElement = document.querySelector<HTMLFormElement>(
          "[data-operator-product-form]",
        );
        if (formElement && (editingId || singleCreateOpen)) {
          event.preventDefault();
          formElement.requestSubmit();
        }
      }
      if (event.key === "Escape" && (editingId || singleCreateOpen) && !busy) {
        event.preventDefault();
        resetForm();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [busy, editingId, resetForm, singleCreateOpen]);

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
    setPublicationMode("scheduled");
    setScheduledPublishAt(publishSlots[0]?.value ?? new Date().toISOString());
    setForm((current) => {
      const storeId = current.storeId || scopedStores[0]?.id || "";
      const canPublish =
        scopedStores.find((store) => store.id === storeId)?.canPublish === true;
      return {
        ...emptyForm,
        saleType,
        storeId,
        status: canPublish ? "active" : "pending",
      };
    });
  };

  const startSingleCreate = (saleType: "fixed" | "auction") => {
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

  const addDefectImage = (
    code: string,
    label: string,
    file: File | undefined,
  ) => {
    if (!file) return;
    if (singleImages.length >= 15) {
      setNotice("단품 사진은 하자 상세 사진을 포함해 최대 15장입니다.");
      return;
    }
    const photoNumber = singleImages.length + 1;
    setSingleImages((current) => [
      ...current,
      { file, id: crypto.randomUUID(), previewUrl: URL.createObjectURL(file) },
    ]);
    const severity = defectSeverities[code] ?? "경미";
    setForm((current) => ({
      ...current,
      inspectionNotes: [
        ...current.inspectionNotes
          .split("\n")
          .filter((line) => line && !line.startsWith(`[하자:${code}]`)),
        `[하자:${code}] ${label} · ${severity} · 사진 ${photoNumber}번`,
      ].join("\n"),
    }));
  };
  const updateDefectSeverity = (
    code: string,
    label: string,
    severity: "경미" | "보통" | "심함",
  ) => {
    setDefectSeverities((current) => ({ ...current, [code]: severity }));
    setForm((current) => ({
      ...current,
      inspectionNotes: current.inspectionNotes
        .split("\n")
        .map((line) =>
          line.startsWith(`[하자:${code}]`)
            ? line
                .replace(`${label} · 경미`, `${label} · ${severity}`)
                .replace(`${label} · 보통`, `${label} · ${severity}`)
                .replace(`${label} · 심함`, `${label} · ${severity}`)
            : line,
        )
        .join("\n"),
    }));
  };

  const runQuickAi = async () => {
    if (!token || !form.storeId || singleImages.length === 0 || quickAiBusy)
      return;
    quickAiRequestRef.current?.abort();
    const controller = new AbortController();
    quickAiRequestRef.current = controller;
    setQuickAiBusy(true);
    setQuickAiPreview(null);
    setNotice("");
    try {
      const result = await processQuickRegistrationAI(
        singleImages.slice(0, 2).map((image) => image.file),
        {
          title: form.title,
          description: form.description,
          categoryId:
            BATCH_CLOTHING_CATEGORIES.find(
              (item) => item.label === form.category,
            )?.id ?? null,
          sizeLabel: form.sizeLabel,
        },
        token,
        form.storeId,
        controller.signal,
      );
      const enhancement = isAiEnhancementApplied(result.status)
        ? result.enhancement
        : null;
      if (!enhancement) {
        setNotice(
          "AI 분석을 완료하지 못해 기존 입력값을 유지했습니다. 잠시 후 다시 시도해 주세요.",
        );
        return;
      }
      setQuickAiPreview(enhancement);
      setNotice(
        "AI 보정안을 만들었습니다. 변경 내용을 확인한 뒤 적용해 주세요.",
      );
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
    const shouldApply = (field: keyof FormState) =>
      !fields || fields.has(field);
    setForm((current) => ({
      ...current,
      title: shouldApply("title")
        ? quickAiPreview.enhancedTitle
        : current.title,
      gender: shouldApply("gender") ? quickAiPreview.gender : current.gender,
      brand: shouldApply("brand") ? quickAiPreview.brand : current.brand,
      category: shouldApply("category")
        ? (quickAiPreview.categoryLabel ?? current.category)
        : current.category,
      sizeLabel: shouldApply("sizeLabel")
        ? quickAiPreview.sizeLabel
        : current.sizeLabel,
      description: shouldApply("description")
        ? quickAiPreview.refinedDescription
        : current.description,
    }));
    setQuickAiPreview(null);
    setNotice(
      "선택한 AI 보정안을 입력란에 적용했습니다. 등록 전에 최종 확인해 주세요.",
    );
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

  const setSingleImageAsCover = (id: string) => {
    setSingleImages((current) => {
      const index = current.findIndex((image) => image.id === id);
      if (index <= 0) return current;
      const next = [...current];
      const [cover] = next.splice(index, 1);
      next.unshift(cover);
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
        categoryId:
          BATCH_CLOTHING_CATEGORIES.find(
            (item) => item.label === snapshot.form.category,
          )?.id ?? null,
        sizeLabel: snapshot.form.sizeLabel,
        defectTags: snapshot.form.defectTags,
        inspectionNotes: splitLines(snapshot.form.inspectionNotes),
        measurements: collectMeasurements(snapshot.form.measurements),
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
        publishAt: snapshot.publishAt,
        scheduledHourKst: snapshot.scheduledHourKst,
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
      const payload = (await response.json()) as {
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
      setRegistrationResult({
        jobId: snapshot.id,
        kind: "success",
        title: snapshot.form.title,
      });
      let message =
        snapshot.publicationMode === "scheduled"
          ? `“${snapshot.form.title}” 단품 등록과 ${formatScheduledPublishAt(snapshot.publishAt)} 공개 예약을 완료했습니다.`
          : `“${snapshot.form.title}” 단품 등록을 완료했습니다.`;
      if (snapshot.canPublishImmediately) {
        if (!payload.product?.id) {
          message = `“${snapshot.form.title}” 상품은 저장했지만 즉시 공개 결과를 확인하지 못했습니다. 업로드 예정 목록을 확인해 주세요.`;
        } else {
          try {
            await publishProductNow(snapshot.accessToken, payload.product.id);
            message = `“${snapshot.form.title}” 상품을 등록하고 지금 공개했습니다.`;
          } catch (error) {
            const reason =
              error instanceof Error
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
      setRegistrationResult({
        jobId: snapshot.id,
        kind: "failure",
        title: snapshot.form.title,
      });
      const reason =
        error instanceof Error ? error.message : "상품을 저장하지 못했습니다.";
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
    setRegistrationResult({
      jobId,
      kind: "retrying",
      title: retrySnapshot.form.title,
    });
    void processSingleRegistration(retrySnapshot);
  };

  const restoreFailedRegistration = (jobId: string) => {
    const snapshot = singleRegistrationSnapshotsRef.current.get(jobId);
    dismissFailedSingleRegistration(jobId);
    setRegistrationResult(null);
    if (!snapshot) return;
    setEditingId(null);
    setEditingUpdatedAt(null);
    setSingleCreateOpen(true);
    setForm({ ...snapshot.form });
    singleImagesRef.current.forEach((image) =>
      URL.revokeObjectURL(image.previewUrl),
    );
    setSingleImages(
      snapshot.files.map((file) => ({
        file,
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
      })),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
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
      const parsed = parseBrandAndSizeFromTitle(form.title);
      const canPublishStore =
        stores.find((store) => store.id === form.storeId)?.canPublish === true;
      const snapshot: SingleRegistrationSnapshot = {
        accessToken: token,
        canPublishImmediately:
          canPublishStore && effectivePublicationMode === "now",
        files: singleImages.map((image) => image.file),
        form: {
          ...form,
          brand: parsed.brand ?? "",
          sizeLabel: parsed.size ?? "",
          conditionGrade: "A",
        },
        id: crypto.randomUUID(),
        productId: crypto.randomUUID(),
        publicationMode: effectivePublicationMode,
        publishAt:
          effectivePublicationMode === "now"
            ? new Date().toISOString()
            : scheduledPublishAt,
        scheduledHourKst,
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
    setBusy(true);
    setNotice("");
    try {
      if (
        editingId &&
        (!permissions.canMutate ||
          !editingProduct ||
          !editingUpdatedAt ||
          !isManageableProductStatus(editingProduct.status))
      ) {
        throw new Error(
          "수정할 상품의 최신 상태를 확인하지 못했습니다. 목록을 새로고침해 주세요.",
        );
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
        defectTags: form.defectTags,
        measurements: collectMeasurements(form.measurements),
      };
      const response = await fetch(
        `/api/admin/operator/products/${editingId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json()) as {
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
          message =
            "상품 정보는 저장했지만 즉시 공개 결과를 확인하지 못했습니다. 업로드 예정 목록을 확인해 주세요.";
        } else {
          try {
            await publishProductNow(token, payload.product.id);
            message = "상품 정보를 저장하고 지금 공개했습니다.";
          } catch (error) {
            const reason =
              error instanceof Error
                ? error.message
                : "즉시 공개 결과를 확인하지 못했습니다.";
            message = `상품 정보는 저장했지만 즉시 공개하지 못했습니다. ${reason}`;
          }
        }
      }
      setNotice(message);
      resetForm();
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "상품을 저장하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
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
      defectTags: product.defect_tags ?? [],
      measurements: measurementStrings(product.measurements),
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
    const confirmation =
      product.status === "active"
        ? `공개 중인 “${product.title}” 상품을 삭제할까요? 사이트에서 즉시 사라집니다. 입찰·주문 이력이 있으면 삭제되지 않습니다.`
        : `“${product.title}” 공개 처리 중 상품을 삭제할까요?`;
    if (!window.confirm(confirmation)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/admin/operator/products/${product.id}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ expectedUpdatedAt: product.updated_at }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "상품을 삭제하지 못했습니다.");
      setNotice("상품을 삭제했습니다.");
      if (editingId === product.id) resetForm();
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "상품을 삭제하지 못했습니다.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pause = async (product: Product) => {
    if (!token || busy || product.status !== "active") return;
    if (!window.confirm(`“${product.title}” 상품 공개를 일시중지할까요?`))
      return;
    setBusy(true);
    setNotice("");
    const previousProducts = products;
    setOptimisticProductStatus(product.id, "pending");
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id ? { ...item, status: "pending" } : item,
      ),
    );
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
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "상품을 일시중지하지 못했습니다.");
      }
      setNotice("상품 공개를 일시중지했습니다.");
      if (editingId === product.id) resetForm();
      await load(token);
    } catch (error) {
      setProducts(previousProducts);
      setNotice(
        error instanceof Error
          ? error.message
          : "상품을 일시중지하지 못했습니다.",
      );
    } finally {
      setOptimisticProductStatus(product.id, null);
      setBusy(false);
    }
  };

  const publish = async (product: Product) => {
    if (!token || busy || product.status !== "pending") return;
    setBusy(true);
    setNotice("");
    const previousProducts = products;
    setOptimisticProductStatus(product.id, "active");
    setProducts((current) =>
      current.map((item) =>
        item.id === product.id ? { ...item, status: "active" } : item,
      ),
    );
    try {
      await publishProductNow(token, product.id);
      setNotice("상품을 공개했습니다.");
      await load(token);
    } catch (error) {
      setProducts(previousProducts);
      setNotice(
        error instanceof Error ? error.message : "상품을 공개하지 못했습니다.",
      );
    } finally {
      setOptimisticProductStatus(product.id, null);
      setBusy(false);
    }
  };

  const togglePending = (productId: string) => {
    const product = products.find((candidate) => candidate.id === productId);
    if (
      !product ||
      !stores.some((store) => store.id === product.store_id && store.canPublish)
    )
      return;
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
      if (allVisiblePendingSelected)
        visiblePendingIds.forEach((id) => next.delete(id));
      else visiblePendingIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const publishSelected = async () => {
    if (
      !permissions.canPublish ||
      !token ||
      busy ||
      selectedPendingIds.size === 0
    )
      return;
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
      setNotice(
        failedIds.length > 0
          ? `${published}개 상품을 공개했고 ${failedIds.length}개는 공개되지 않아 선택 상태로 남겼습니다.`
          : `${published}개 상품을 지금 공개했습니다.`,
      );
      await load(token);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "선택한 상품을 공개하지 못했습니다.",
      );
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
    let completedImages = 0;
    let persisted = false;

    setBusy(true);
    setNotice("");
    try {
      onProgress(0, totalImages, "uploading");
      const productsToInsert = await mapWithConcurrency(
        preview.rows,
        5,
        async (row, productIndex): Promise<Record<string, unknown>> => {
        if (!row.draft)
          throw new Error(
            `${productIndex + 1}번째 상품의 검증 결과가 유효하지 않습니다.`,
          );
        const draft = row.draft;
        const productId = crypto.randomUUID();
        let reportedForProduct = 0;
        const uploaded = await uploadProductImages(
          draft.imageFiles,
          productId,
          (completedForProduct) => {
            completedImages += completedForProduct - reportedForProduct;
            reportedForProduct = completedForProduct;
            onProgress(
              completedImages,
              totalImages,
              "uploading",
            );
          },
          undefined,
          { concurrency: 1 },
        );
        uploadedPaths.push(...uploaded.paths);
        return {
          id: productId,
          title: draft.title,
          brand: inferBrandFromTitle(draft.title).brand,
          gender: row.category?.gender ?? "",
          description: draft.description,
          category: row.category?.label ?? "기타",
          categoryId: row.category?.id ?? null,
          quantity: row.quantity,
          storeId: scopedStoreId,
          saleType: draft.saleType,
          startingPrice: draft.startingPrice,
          fixedPrice: draft.fixedPrice ?? undefined,
          bidIncrement: draft.bidIncrement,
          imageUrls: uploaded.imageUrls,
          thumbnailUrls: uploaded.thumbnailUrls,
          publishAt: draft.publish_at,
          closesAt:
            draft.saleType === "fixed"
              ? FIXED_PRODUCT_OPEN_UNTIL
              : getNextAuctionDeadline(draft.publish_at).toISOString(),
          sizeLabel: row.size,
          conditionGrade: importedConditionGrade(row.condition),
          storageClass: row.storageClass,
          inspectionNotes: [],
          defectTags: row.defectTags,
          searchTags: row.searchTags,
        };
      });

      onProgress(totalImages, totalImages, "saving");
      const response = await fetch("/api/admin/operator/products/bulk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ products: productsToInsert }),
      });
      const payload = (await response.json().catch(() => null)) as {
        products?: Array<{ id: string }>;
        count?: number;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error ?? "검증된 상품을 저장하지 못했습니다.");
      persisted = true;
      const count = payload?.count ?? productsToInsert.length;
      const canPublish =
        stores.find((store) => store.id === scopedStoreId)?.canPublish === true;
      const insertedIds = (payload?.products ?? []).map(
        (product) => product.id,
      );
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
      setNotice(
        canPublish && options.publicationMode === "now"
          ? `${published}개 엑셀 상품을 즉시 공개했습니다.${published < count ? ` ${count - published}개는 업로드 예정으로 남았습니다.` : ""}`
          : canPublish
            ? `${count}개 엑셀 상품을 상품별 공개 시각 기준으로 등록했습니다.`
            : `${count}개 엑셀 상품을 업로드 예정으로 저장했습니다.`,
      );
      try {
        await load(token);
      } catch {
        setNotice(
          `${count}개 엑셀 상품을 저장했습니다. 목록 새로고침이 필요합니다.`,
        );
      }
      pushToast("success", `${count}개 상품을 일괄 등록했습니다.`);
      router.replace("/admin/operator/products");
      router.refresh();
      return count;
    } catch (error) {
      if (!persisted) await discardUnpersistedProductImages(uploadedPaths);
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const registrationClock = getKoreanAuctionTime(productReferenceNow);
  const immediatePublishingBlocked = registrationClock.secondsSinceMidnight >= 21 * 60 * 60
    && registrationClock.secondsSinceMidnight < 22 * 60 * 60;
  const effectivePublicationMode: PublicationMode =
    publicationMode === "now" && !immediatePublishingBlocked ? "now" : "scheduled";
  const singleRegistrationSubmitLabel =
    effectivePublicationMode === "now"
      ? `${form.saleType === "fixed" ? "즉시구매" : "경매"} 등록하고 즉시 공개`
      : `${form.saleType === "fixed" ? "즉시구매" : "경매"} 등록하고 ${formatScheduledPublishAt(scheduledPublishAt)} 예약`;
  const singleRegistrationDisabled =
    busy || !token || !productFieldsEditable || singleImages.length === 0;

  return (
    <div className="space-y-8">
      <SectionHeading
        description={
          view === "active"
            ? "현재 공개 중인 상품과 결제 진행 중·낙찰 대기로 선점된 상품을 판매 방식별로 나누어 관리합니다."
            : "신규 상품을 등록합니다. 예약 공개 상품은 상품 목록의 업로드 예정에서 확인합니다."
        }
        eyebrow={view === "active" ? "운영자 / 상품" : "운영자 / 상품 등록"}
        title={view === "active" ? "진행 중 상품" : "상품 등록"}
        variant="page"
      />
      {notice && <StatusNotice>{notice}</StatusNotice>}
      {view === "registration" && !singleCreateOpen && !editingId && (
        <section
          aria-label="상품 등록 방식 선택"
          className="grid gap-3 lg:grid-cols-[1.35fr_.65fr]"
        >
          <div className="border border-ink bg-surface p-5 sm:p-6">
            <p className="eyebrow text-muted">일반 상품 등록</p>
            <h2 className="mt-2 text-xl font-black tracking-[-.05em]">
              한 상품씩 차근차근 등록
            </h2>
            <p className="mt-2 text-xs leading-5 text-muted">
              사진, 상품 정보, 가격, 공개 순서로 진행합니다. 처음 판매하는
              분에게 권장합니다.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button
                className="flex min-h-12 items-center justify-center gap-2"
                disabled={!token || !permissions.canCreate}
                onClick={() => startSingleCreate("fixed")}
                type="button"
                variant="primary"
              >
                <Plus size={15} /> 즉시구매 상품 등록
              </Button>
              <Button
                className="flex min-h-12 items-center justify-center gap-2"
                disabled={!token || !permissions.canCreate}
                onClick={() => startSingleCreate("auction")}
                type="button"
              >
                <Plus size={15} /> 경매 상품 등록
              </Button>
            </div>
          </div>
          <div className="border border-line bg-paper p-5 sm:p-6">
            <p className="eyebrow text-muted">대량 등록</p>
            <h2 className="mt-2 text-lg font-black tracking-[-.04em]">
              엑셀로 여러 상품 등록
            </h2>
            <p className="mt-2 text-xs leading-5 text-muted">
              형식이 준비된 판매자를 위한 별도 작업입니다.
            </p>
            <Button
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2"
              disabled={
                !token ||
                !permissions.canCreate ||
                busy ||
                !stores.some((store) => store.entitlements?.bulkImportEnabled)
              }
              onClick={() => setXlsxImportOpen(true)}
              title={
                stores.some((store) => store.entitlements?.bulkImportEnabled)
                  ? undefined
                  : "월 5만원 등급 매장에서 사용할 수 있습니다."
              }
              type="button"
            >
              <FileSpreadsheet size={15} /> 엑셀 대량 등록
            </Button>
          </div>
        </section>
      )}
      {view === "registration" && singleRegistrationJobs.length > 0 && (
        <section
          aria-live="polite"
          className="border border-line bg-surface px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold">단품 백그라운드 저장</p>
            <p className="font-mono text-[10px] text-muted">
              {pendingSingleRegistrationCount > 0
                ? `${pendingSingleRegistrationCount}건 처리 중`
                : "처리 대기 없음"}
            </p>
          </div>
          {pendingSingleRegistrationCount > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              사진 처리와 저장이 진행되는 동안 간편등록칸에서 다음 상품을 계속
              등록할 수 있습니다. 완료 전에는 이 페이지를 닫지 마세요.
            </p>
          )}
          {failedSingleRegistrations.length > 0 && (
            <div className="mt-3 space-y-2">
              {failedSingleRegistrations.map((job) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2"
                  key={job.id}
                >
                  <p className="min-w-0 truncate text-[11px] font-bold text-red-700">
                    “{job.title}” 등록 실패
                  </p>
                  <div className="flex gap-2">
                    <Button
                      disabled={!token}
                      onClick={() => retrySingleRegistration(job.id)}
                      size="compact"
                      type="button"
                    >
                      다시 시도
                    </Button>
                    <Button
                      onClick={() => dismissFailedSingleRegistration(job.id)}
                      size="compact"
                      type="button"
                      variant="ghost"
                    >
                      닫기
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {view === "active" ? (
        <nav
          aria-label="진행 상품 판매 방식"
          className="grid grid-cols-2 border border-ink"
        >
          {(["fixed", "auction"] as const).map((saleType) => (
            <button
              aria-pressed={filter.saleType === saleType}
              className={`min-h-12 px-4 text-xs font-black ${filter.saleType === saleType ? "bg-ink text-paper" : "bg-paper text-ink"}`}
              key={saleType}
              onClick={() => setFilter((current) => ({ ...current, saleType }))}
              type="button"
            >
              {saleType === "fixed" ? "즉시구매 상품" : "경매 상품"}{" "}
              <span className="ml-1 font-mono">
                {activeProductCounts[saleType]}
              </span>
            </button>
          ))}
        </nav>
      ) : (
        <div
          aria-label="상품 등록 상태"
          className="border border-ink"
        >
          <span
            className="flex min-h-12 items-center justify-center bg-ink px-4 text-xs font-black text-paper"
            role="status"
          >
            예약 공개{" "}
            <span className="ml-1 font-mono">
              {registrationCounts.scheduled}
            </span>
            {registrationCounts.draft > 0 && (
              <span className="ml-2 font-mono text-paper/70">
                · 일시중지 {registrationCounts.draft}
              </span>
            )}
          </span>
        </div>
      )}
      {view === "registration" && overdueScheduledCount > 0 && (
        <StatusNotice>
          공개 예정 시각이 지난 상품 {overdueScheduledCount}건을 확인했습니다. 자동
          공개 작업이 매분 다시 시도하며, 필요하면 상품의 공개 버튼으로 즉시
          처리할 수 있습니다.
        </StatusNotice>
      )}
      {view === "registration" &&
        products.some(
          (product) =>
            product.brand_source === "inferred" && product.status === "pending",
        ) && (
          <StatusNotice>
            등록 대기 상품 중 제목에서 임시 추론한 브랜드가 있습니다. 수정
            저장하면 확인된 브랜드로 전환됩니다.
          </StatusNotice>
        )}
      {view === "registration" &&
        products.some(
          (product) =>
            product.brand_source === "inferred" && product.status === "pending",
        ) && (
          <section className="border border-amber-200 bg-amber-500/10 p-4">
            <p className="text-xs font-bold text-amber-900">브랜드 확인 필요</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {products
                .filter(
                  (product) =>
                    product.brand_source === "inferred" &&
                    product.status === "pending",
                )
                .map((product) => (
                  <button
                    className="border border-amber-300 bg-paper px-3 py-2 text-left text-[11px] text-amber-900 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!permissions.canMutate}
                    key={product.id}
                    onClick={() => edit(product)}
                    type="button"
                  >
                    <span className="font-bold">{product.brand}</span> ·{" "}
                    {product.title}
                  </button>
                ))}
            </div>
          </section>
        )}
      {(editingId || (view === "registration" && singleCreateOpen)) && (
        <form
          className="grid grid-cols-1 gap-3 border border-ink bg-surface p-4 sm:grid-cols-2 sm:p-6"
          data-operator-product-form
          onSubmit={submit}
        >
          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {editingId
                  ? "상품 수정"
                  : form.saleType === "fixed"
                    ? "즉시구매 상품 등록"
                    : "경매 상품 등록"}
              </p>
              {!editingId && (
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  {form.saleType === "auction"
                    ? "사진을 먼저 선택하세요. 상품명은 피드에 보이는 간판글로 필수이며 성별은 선택 사항입니다."
                    : "사진을 먼저 선택하세요. 상품명은 피드에 보이는 간판글로 필수이며 상품설명과 성별은 선택 사항입니다."}
                </p>
              )}
            </div>
            {editingId ? (
              <Button
                className="shrink-0"
                size="compact"
                variant="ghost"
                onClick={resetForm}
                type="button"
              >
                <X size={13} /> 수정 취소
              </Button>
            ) : (
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                <Button
                  className="px-5"
                  disabled={singleRegistrationDisabled}
                  size="compact"
                  variant="primary"
                  type="submit"
                >
                  {singleRegistrationSubmitLabel}
                </Button>
                <Button
                  className="px-5"
                  onClick={resetForm}
                  size="compact"
                  type="button"
                >
                  취소
                </Button>
              </div>
            )}
          </div>

          {!editingId && (
            <ol
              aria-label="상품 등록 단계"
              className="grid gap-2 sm:col-span-2 sm:grid-cols-3"
            >
              <li className="border border-ink bg-ink p-3 text-paper">
                <span className="text-[10px] font-mono">STEP 1</span>
                <strong className="mt-1 block text-xs">기본 정보·사진</strong>
              </li>
              <li className="border border-line bg-paper p-3">
                <span className="text-[10px] font-mono text-muted">STEP 2</span>
                <strong className="mt-1 block text-xs">실측·상태·하자</strong>
              </li>
              <li className="border border-line bg-paper p-3">
                <span className="text-[10px] font-mono text-muted">STEP 3</span>
                <strong className="mt-1 block text-xs">판매 방식·공개</strong>
              </li>
            </ol>
          )}

          {!editingId && (
            <section className="border border-line bg-paper p-4 sm:col-span-2">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-xs font-black">1. 상품 사진 선택</p>
                  <p className="mt-1 text-[11px] text-muted">
                    최대 15장 · 표시된 순서대로 저장 · 첫 사진이 대표
                    {quickAiBusy ? " · AI 분석 중…" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !token ||
                      !form.storeId ||
                      singleImages.length === 0 ||
                      quickAiBusy
                    }
                    onClick={() => void runQuickAi()}
                    type="button"
                    variant="primary"
                  >
                    <Sparkles size={15} />{" "}
                    {quickAiBusy ? "AI 분석 중" : "AI 자동 보정"}
                  </Button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 border border-ink px-4 py-3 text-xs font-bold">
                    <ImagePlus size={15} /> 사진 선택
                    <input
                      accept={PRODUCT_IMAGE_INPUT_ACCEPT}
                      className="sr-only"
                      multiple
                      onChange={(event) => {
                        addSingleImages(event.currentTarget.files);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                  </label>
                </div>
              </div>
              {selectedEntitlements && (
                <div className="mt-4 grid gap-2 border border-line bg-surface p-3 text-[10px] font-bold sm:grid-cols-2 lg:grid-cols-4" aria-label="센터 상품 공개 한도">
                  <p>센터 등급 <strong className="block pt-1 text-sm text-ink">{selectedEntitlements.planCode === "pro" ? "Pro" : "일반"}</strong></p>
                  <p>이번 달 공개 <strong className="block pt-1 text-sm text-ink">{selectedEntitlements.monthlyPublished ?? 0} / {selectedEntitlements.monthlyPublicationLimit ?? (selectedEntitlements.planCode === "pro" ? 1600 : 800)}</strong></p>
                  <p>오늘 즉시 / 예약 <strong className="block pt-1 text-sm text-ink">{selectedEntitlements.immediatePublished ?? 0}/{selectedEntitlements.immediateDailyLimit ?? 30} · {selectedEntitlements.scheduledPublished ?? 0}/{selectedEntitlements.scheduledDailyLimit ?? 40}</strong></p>
                  <p>초안·예약 대기 <strong className="block pt-1 text-sm text-ink">{selectedEntitlements.pendingInventoryUsed ?? selectedEntitlements.productsCreated} / {selectedEntitlements.pendingInventoryLimit ?? selectedEntitlements.productDailyLimit ?? (selectedEntitlements.planCode === "pro" ? 320 : 120)}</strong></p>
                </div>
              )}
              {singleImages.length > 0 ? (
                <ol className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {singleImages.map((image, index) => (
                    <li
                      className={`relative border bg-surface p-2 ${index === 0 ? "border-ink ring-1 ring-ink" : "border-line"}`}
                      key={image.id}
                    >
                      {index === 0 && (
                        <span className="absolute left-3 top-3 z-10 bg-ink px-2 py-1 text-[9px] font-black text-paper shadow-sm">
                          대표 사진
                        </span>
                      )}
                      <CatalogImage
                        alt={`선택 사진 ${index + 1}`}
                        className="aspect-square w-full object-cover"
                        src={image.previewUrl}
                      />
                      <p className="mt-2 truncate text-[10px] font-bold">
                        {index + 1}. {image.file.name}
                      </p>
                      {index > 0 && (
                        <button
                          className="mt-2 min-h-11 w-full border border-ink px-2 text-[10px] font-black active:scale-[0.98]"
                          onClick={() => setSingleImageAsCover(image.id)}
                          type="button"
                        >
                          대표 지정
                        </button>
                      )}
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        <button
                          aria-label={`${index + 1}번 사진 앞으로 이동`}
                          className="grid min-h-11 place-items-center border border-line active:scale-[0.98] disabled:opacity-30"
                          disabled={index === 0}
                          onClick={() => moveSingleImage(index, -1)}
                          type="button"
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <button
                          aria-label={`${index + 1}번 사진 뒤로 이동`}
                          className="grid min-h-11 place-items-center border border-line active:scale-[0.98] disabled:opacity-30"
                          disabled={index === singleImages.length - 1}
                          onClick={() => moveSingleImage(index, 1)}
                          type="button"
                        >
                          <ArrowRight size={14} />
                        </button>
                        <button
                          aria-label={`${index + 1}번 사진 삭제`}
                          className="grid min-h-11 place-items-center border border-red-200 text-red-700 active:scale-[0.98]"
                          onClick={() => removeSingleImage(image.id)}
                          type="button"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 border border-dashed border-line px-4 py-8 text-center text-xs text-muted">
                  등록할 사진을 먼저 선택해 주세요.
                </p>
              )}
              {quickAiPreview && (
                <div className="mt-4 border border-violet-200 bg-violet-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-black text-violet-950">
                        AI 자동 보정 미리보기
                      </p>
                      <p className="mt-1 text-[10px] text-violet-800">
                        각 항목을 적용하거나 전체 적용한 뒤 직접 수정할 수
                        있습니다.
                      </p>
                    </div>
                    <Button
                      onClick={() => applyQuickAi()}
                      size="compact"
                      type="button"
                      variant="primary"
                    >
                      전체 적용
                    </Button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {(
                      [
                        [
                          "title",
                          "상품명",
                          form.title,
                          quickAiPreview.enhancedTitle,
                        ],
                        ["gender", "성별", form.gender, quickAiPreview.gender],
                        ["brand", "브랜드", form.brand, quickAiPreview.brand],
                        [
                          "category",
                          "카테고리",
                          form.category,
                          quickAiPreview.categoryLabel ?? form.category,
                        ],
                        [
                          "sizeLabel",
                          "사이즈",
                          form.sizeLabel,
                          quickAiPreview.sizeLabel,
                        ],
                        [
                          "description",
                          "설명",
                          form.description,
                          quickAiPreview.refinedDescription,
                        ],
                      ] as const
                    ).map(([field, label, before, after]) => (
                      <div
                        className="border border-violet-200 bg-paper p-3"
                        key={field}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black">{label}</p>
                          <button
                            className="text-[10px] font-bold underline"
                            onClick={() => applyQuickAi(new Set([field]))}
                            type="button"
                          >
                            이 항목 적용
                          </button>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[10px] text-muted">
                          기존: {before || "미입력"}
                        </p>
                        <p className="mt-1 line-clamp-3 text-[11px] font-bold">
                          제안: {after || "미입력"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {!editingId && (
            <div className="border-b border-ink pb-3 pt-2 sm:col-span-2">
              <p className="text-xs font-black">2. 상품 정보</p>
              <p className="mt-1 text-[11px] text-muted">
                상품명은 필수이며 나머지는 확인 가능한 정보만 입력하세요.
              </p>
            </div>
          )}

          {editingId ? (
            <>
              <TextInput
                aria-label="상품명"
                disabled={!productFieldsEditable}
                onChange={(event) => updateTitle(event.target.value)}
                placeholder="상품명"
                required
                value={form.title}
              />
            </>
          ) : (
            <>
              <TextInput
                aria-label="상품명"
                onChange={(event) => updateTitle(event.target.value)}
                placeholder="상품명 (필수)"
                required
                value={form.title}
              />
              {form.saleType === "auction" ? (
                <TextInput
                  aria-label="경매 시작가"
                  min="1"
                  onChange={(event) => update("price", event.target.value)}
                  placeholder="경매 시작가"
                  required
                  type="number"
                  value={form.price}
                />
              ) : null}
            </>
          )}

          {!editingId && (
            <>
              <GenderCategorySelect
                category={form.category}
                gender={registrationGender(form)}
                onChange={(gender, category) => {
                  setForm((current) => ({
                    ...current,
                    gender:
                      gender === "남녀공용"
                        ? "공용"
                        : gender === "잡화/액세서리"
                          ? ""
                          : gender,
                  }));
                  updateCategory(category);
                }}
              />
              <MeasurementFields
                category={form.category}
                onChange={updateMeasurement}
                values={form.measurements}
              />
            </>
          )}
          {!editingId && (
            <div className="border-b border-ink pb-3 pt-2 sm:col-span-2">
              <p className="text-xs font-black">3. 판매 정보</p>
              <p className="mt-1 text-[11px] text-muted">
                판매 매장과 가격, 보관 기준을 확인하세요.
              </p>
            </div>
          )}
          {editingId ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <SelectInput
                aria-label="판매 방식"
                className="flex-1"
                disabled={!saleSetupEditable}
                onChange={(event) => update("saleType", event.target.value)}
                value={form.saleType}
              >
                <option value="fixed">즉시구매</option>
                <option value="auction">경매</option>
              </SelectInput>
              <TextInput
                aria-label="가격"
                className="w-full sm:w-40"
                disabled={!saleSetupEditable}
                min="1"
                onChange={(event) => update("price", event.target.value)}
                placeholder="가격"
                required
                type="number"
                value={form.price}
              />
            </div>
          ) : form.saleType === "fixed" ? (
            <TextInput
              aria-label="즉시구매 가격"
              min="1"
              onChange={(event) => update("price", event.target.value)}
              placeholder="즉시구매 가격"
              required
              type="number"
              value={form.price}
            />
          ) : null}
          <TextArea
            aria-label="상품 설명"
            className="min-h-24 sm:col-span-2"
            disabled={!productFieldsEditable}
            onChange={(event) => update("description", event.target.value)}
            placeholder={editingId ? "상품 설명" : "상품 설명 (선택)"}
            required={Boolean(editingId)}
            value={form.description}
          />

          {editingId ? (
            <>
              <GenderCategorySelect
                category={form.category}
                gender={registrationGender(form)}
                onChange={(gender, category) => {
                  setForm((current) => ({
                    ...current,
                    gender:
                      gender === "남녀공용"
                        ? "공용"
                        : gender === "잡화/액세서리"
                          ? ""
                          : gender,
                  }));
                  updateCategory(category);
                }}
              />
              <div className="flex gap-2 sm:col-span-2">
                <SelectInput
                  aria-label="보관 등급"
                  className="flex-1"
                  disabled={!productFieldsEditable}
                  onChange={(event) =>
                    update("storageClass", event.target.value)
                  }
                  value={form.storageClass}
                >
                  <option value="small">소형 · 14일</option>
                  <option value="large">대형 · 7일</option>
                </SelectInput>
              </div>
              <MeasurementFields
                category={form.category}
                disabled={!productFieldsEditable}
                onChange={updateMeasurement}
                values={form.measurements}
              />
              <details className="group border border-line bg-paper sm:col-span-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-xs font-black focus-visible:ring-2 focus-visible:ring-ink">
                  하자·오염 체크리스트 (선택 사항)
                  <ChevronDown
                    className="transition-transform group-open:rotate-180"
                    size={16}
                  />
                </summary>
                <fieldset className="border-t border-line p-4">
                  <legend className="text-[10px] font-bold text-muted">
                    하자·오염 체크리스트{" "}
                    <span className="font-normal">(해당 항목만 선택)</span>
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {DEFECT_TAGS.map((tag) => {
                      const checked = form.defectTags.includes(tag.code);
                      return (
                        <label
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors ${checked ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
                          key={tag.code}
                        >
                          <input
                            checked={checked}
                            className="accent-ink"
                            disabled={!productFieldsEditable}
                            onChange={() => toggleDefect(tag.code)}
                            type="checkbox"
                          />
                          {tag.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </details>
              <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-muted">
                  <span className="mb-2 block">공개 시각</span>
                  <TextInput
                    aria-label="공개 시각"
                    className="w-full text-ink"
                    disabled={!saleSetupEditable}
                    onChange={(event) =>
                      update("publishAt", event.target.value)
                    }
                    type="datetime-local"
                    value={form.publishAt}
                  />
                </label>
                {form.saleType === "auction" ? (
                  <label className="text-[10px] font-bold text-muted">
                    <span className="mb-2 block">경매 마감 시각</span>
                    <TextInput
                      aria-label="경매 마감 시각"
                      className="w-full text-ink"
                      disabled={!saleSetupEditable}
                      onChange={(event) =>
                        update("closesAt", event.target.value)
                      }
                      type="datetime-local"
                      value={form.closesAt}
                    />
                  </label>
                ) : (
                  <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">
                    즉시구매 상품은 구매 확정 시 마감되므로 별도 마감 시각을
                    사용하지 않습니다.
                  </div>
                )}
              </div>
              <TextArea
                aria-label="점검·하자 메모"
                className="min-h-20 sm:col-span-2"
                disabled={!productFieldsEditable}
                onChange={(event) =>
                  update("inspectionNotes", event.target.value)
                }
                placeholder="오염·수선·사용감 등 객관적인 상태 정보를 한 줄씩 입력"
                ref={inspectionNotesRef}
                value={form.inspectionNotes}
              />
              <TextArea
                aria-label="이미지 URL"
                className="min-h-20 sm:col-span-2"
                disabled={!productFieldsEditable}
                onChange={(event) => update("imageUrls", event.target.value)}
                placeholder="이미지 URL을 줄바꿈 또는 쉼표로 입력"
                required
                value={form.imageUrls}
              />
              <p className="text-[11px] leading-5 text-amber-800 sm:col-span-2">
                기존 상품 수정 시에만 현재 이미지 URL을 유지하거나 변경할 수
                있습니다.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <TextInput
                  aria-label="입찰 단위"
                  disabled={!saleSetupEditable}
                  min="1"
                  onChange={(event) =>
                    update("bidIncrement", event.target.value)
                  }
                  placeholder="입찰 단위"
                  type="number"
                  value={form.bidIncrement}
                />
                <SelectInput
                  aria-label="공개 상태"
                  disabled={!saleSetupEditable}
                  onChange={(event) => update("status", event.target.value)}
                  value={form.status}
                >
                  <option value="pending">업로드 예정으로 저장</option>
                  {(form.status === "active" ||
                    stores.find((store) => store.id === form.storeId)
                      ?.canPublish) && (
                    <option value="active">
                      {editingProduct?.status === "active"
                        ? "현재 공개 중"
                        : "저장 후 즉시 공개"}
                    </option>
                  )}
                </SelectInput>
              </div>
              {form.saleType === "auction" && (
                <p className="text-[11px] leading-5 text-muted sm:col-span-2">
                  기본값은 1,000원이며 입찰 단위 입력칸에서 직접 수정할 수
                  있습니다.
                </p>
              )}
            </>
          ) : (
            <>
              <SelectInput
                aria-label="보관 등급"
                onChange={(event) => update("storageClass", event.target.value)}
                value={form.storageClass}
              >
                <option value="small">소형 · 14일 보관</option>
                <option value="large">대형 · 7일 보관</option>
              </SelectInput>
              <details className="group border border-line bg-paper sm:col-span-2">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-xs font-black focus-visible:ring-2 focus-visible:ring-ink">
                  하자·오염 체크리스트 (선택 사항)
                  <ChevronDown
                    className="transition-transform group-open:rotate-180"
                    size={16}
                  />
                </summary>
                <fieldset className="border-t border-line p-4">
                  <legend className="text-[10px] font-bold text-muted">
                    하자·오염 체크리스트{" "}
                    <span className="font-normal">(해당 항목만 선택)</span>
                  </legend>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {DEFECT_TAGS.map((tag) => {
                      const checked = form.defectTags.includes(tag.code);
                      return (
                        <label
                          className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors ${checked ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"}`}
                          key={tag.code}
                        >
                          <input
                            checked={checked}
                            className="accent-ink"
                            onChange={() => toggleDefect(tag.code)}
                            type="checkbox"
                          />
                          {tag.label}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                {form.defectTags.length > 0 && (
                  <section className="space-y-2 border-t border-line p-4">
                    <div>
                      <p className="text-xs font-black">하자 상세 매핑</p>
                      <p className="mt-1 text-[10px] text-muted">
                        하자별 심각도와 근접 사진을 연결합니다. 사진은 전체 상품
                        이미지에도 포함됩니다.
                      </p>
                    </div>
                    {form.defectTags.map((code) => {
                      const tag = DEFECT_TAGS.find(
                        (item) => item.code === code,
                      );
                      if (!tag) return null;
                      return (
                        <div
                          className="grid items-center gap-2 border-t border-line pt-3 sm:grid-cols-[1fr_120px_180px]"
                          key={code}
                        >
                          <strong className="text-xs">{tag.label}</strong>
                          <select
                            aria-label={`${tag.label} 심각도`}
                            className="h-10 border border-line px-3 text-xs"
                            onChange={(event) =>
                              updateDefectSeverity(
                                code,
                                tag.label,
                                event.target.value as "경미" | "보통" | "심함",
                              )
                            }
                            value={defectSeverities[code] ?? "경미"}
                          >
                            <option>경미</option>
                            <option>보통</option>
                            <option>심함</option>
                          </select>
                          <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 border border-ink px-3 text-xs font-bold">
                            <ImagePlus size={14} />
                            상세 사진 선택
                            <input
                              accept={PRODUCT_IMAGE_INPUT_ACCEPT}
                              className="sr-only"
                              onChange={(event) => {
                                addDefectImage(
                                  code,
                                  tag.label,
                                  event.currentTarget.files?.[0],
                                );
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </section>
                )}
              </details>
              {form.saleType === "auction" ? (
                <>
                  <label className="text-[10px] font-bold text-muted">
                    <span className="mb-2 block">최소 입찰 단위 (원)</span>
                    <TextInput
                      aria-label="최소 입찰 단위"
                      min="1"
                      onChange={(event) =>
                        update("bidIncrement", event.target.value)
                      }
                      placeholder="1,000"
                      type="number"
                      value={form.bidIncrement}
                    />
                  </label>
                  <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">
                    기본값은 1,000원이며 입력칸에서 상품별로 자유롭게 수정할 수
                    있습니다. 첫 입찰은 시작가부터 시작하고 이후 입찰은 현재가 +
                    최소 입찰 단위로 올라갑니다.
                  </div>
                </>
              ) : (
                <div className="border border-line bg-paper px-4 py-3 text-[11px] leading-5 text-muted">
                  즉시구매 상품은 입찰 단위를 사용하지 않습니다.
                </div>
              )}
              <div className="border-b border-ink pb-3 pt-2 sm:col-span-2">
                <p className="text-xs font-black">4. 공개 설정</p>
                <p className="mt-1 text-[11px] text-muted">
                  즉시 공개하거나 원하는 시간에 예약할 수 있습니다. 예약 시점의 하루 한도가 가득 차면 다음날 오전 10시로 자동 이월됩니다.
                </p>
                {immediatePublishingBlocked && (
                  <p className="mt-2 text-[11px] font-bold text-amber-700">21:00~22:00는 경매 마감 및 동기화 점검 중이므로 즉시 공개가 차단됩니다.</p>
                )}
              </div>
              <div className="grid items-end gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto]">
                <label className="text-xs font-bold">
                  예약 공개 시각
                  <SelectInput
                    aria-label="예약 공개 시각"
                    className="mt-2"
                    disabled={effectivePublicationMode === "now"}
                    onChange={(event) => {
                      setScheduledPublishAt(event.target.value);
                      setScheduledHourKst(10);
                    }}
                    value={scheduledPublishAt}
                  >
                    {publishSlots.map((slot) => (
                      <option key={slot.value} value={slot.value}>
                        {slot.label}
                      </option>
                    ))}
                  </SelectInput>
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 border border-line bg-paper px-4 text-xs font-black">
                  <input
                    checked={effectivePublicationMode === "now"}
                    className="size-4 accent-ink"
                    disabled={immediatePublishingBlocked}
                    onChange={(event) =>
                      setPublicationMode(
                        event.target.checked ? "now" : "scheduled",
                      )
                    }
                    type="checkbox"
                  />
                  즉시 공개
                </label>
              </div>
              <div className="flex flex-col gap-2 border-t border-line pt-4 sm:col-span-2 sm:flex-row sm:justify-end">
                <Button
                  className="px-6"
                  disabled={singleRegistrationDisabled}
                  variant="primary"
                  type="submit"
                >
                  {singleRegistrationSubmitLabel}
                </Button>
                <Button className="px-6" onClick={resetForm} type="button">
                  취소
                </Button>
              </div>
            </>
          )}
          {editingId && (
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button
                className="px-5"
                disabled={busy || !token || !productFieldsEditable}
                variant="primary"
                type="submit"
              >
                수정 저장
              </Button>
              <Button className="px-5" onClick={resetForm} type="button">
                수정 취소
              </Button>
            </div>
          )}
        </form>
      )}
      <div className="flex flex-col items-start justify-between gap-3 text-xs text-muted sm:flex-row sm:items-center">
        <span>
          {loading
            ? "상품을 불러오는 중…"
            : `${visibleProducts.length} / ${workspaceProducts.length}개 상품 · 실시간 데이터`}
        </span>
        <div className="flex items-center gap-4">
          <button
            className="flex items-center gap-2 underline"
            disabled={loading}
            onClick={() =>
              void load(token).catch((error) =>
                setNotice(
                  error instanceof Error
                    ? error.message
                    : "새로고침에 실패했습니다.",
                ),
              )
            }
            type="button"
          >
            <RefreshCw size={13} /> 새로고침
          </button>
        </div>
      </div>
      <div
        className={`grid grid-cols-1 gap-3 ${view === "registration" ? "sm:grid-cols-2" : ""}`}
      >
        <input
          aria-label="상품 검색"
          className="border border-line bg-paper px-3 py-3 text-xs"
          onChange={(event) =>
            setFilter({ ...filter, search: event.target.value })
          }
          placeholder="상품명·숍 검색"
          value={filter.search}
        />
        {view === "registration" && (
          <select
            aria-label="판매 방식 필터"
            className="border border-line bg-paper px-3 py-3 text-xs"
            onChange={(event) =>
              setFilter({
                ...filter,
                saleType: event.target.value as "all" | "fixed" | "auction",
              })
            }
            value={filter.saleType}
          >
            <option value="all">전체 판매 방식</option>
            <option value="fixed">즉시구매</option>
            <option value="auction">경매</option>
          </select>
        )}
      </div>
      {view === "registration" && (
        <div className="flex flex-col items-start justify-between gap-3 border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center">
          <label className="flex items-center gap-3 text-xs font-bold">
            <input
              checked={allVisiblePendingSelected}
              disabled={
                busy ||
                !permissions.canPublish ||
                visiblePendingIds.length === 0
              }
              onChange={toggleAllVisiblePending}
              type="checkbox"
            />{" "}
            검색 결과 전체 선택
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-xs text-muted">
              {selectedPendingIds.size}개 선택
            </span>
            {selectedPendingIds.size > 0 && (
              <Button
                disabled={busy}
                onClick={() => setSelectedPendingIds(new Set())}
                size="compact"
                variant="ghost"
                type="button"
              >
                선택 해제
              </Button>
            )}
            <Button
              disabled={
                busy || !permissions.canPublish || selectedPendingIds.size === 0
              }
              onClick={() => void publishSelected()}
              size="compact"
              variant="primary"
              type="button"
            >
              지금 즉시 공개
            </Button>
          </div>
        </div>
      )}
      <div className="grid gap-3 md:hidden">
        {visibleProducts.map((product) => {
          const manageable = isManageableProductStatus(product.status);
          const canPublishStore = stores.some((store) => store.id === product.store_id && store.canPublish);
          const isActive = product.status === "active";
          const scheduled = isScheduledProduct(product);
          const overdue = isOverdueScheduledProduct(product, productReferenceNow);
          return <article className="w-full max-w-full overflow-hidden break-keep rounded-2xl border border-line bg-paper p-4" key={product.id}>
            <div className="flex min-w-0 gap-3"><CatalogImage alt="" className="size-16 shrink-0 rounded-xl object-cover" src={product.image_urls?.[0] ?? ""} /><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold">{product.title}</p><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-md border border-line px-2 py-1 text-[10px] font-bold">Grade {product.condition_grade || "A"}</span><span className="rounded-md border border-line px-2 py-1 text-[10px]">{product.sale_type === "fixed" ? "즉시구매" : "경매"}</span></div><p className="mt-2 font-mono text-sm font-bold">{(product.fixed_price ?? product.current_price).toLocaleString("ko-KR")}원</p>{scheduled && <p className={`mt-1 text-[11px] font-bold ${overdue ? "text-red-700" : "text-muted"}`}>{overdue ? "공개 지연" : "공개 예정"} · {formatScheduledPublishAt(product.publish_at)}</p>}{product.paused_at && <p className="mt-1 text-[11px] font-bold text-amber-700">운영자 일시중지</p>}</div>
              <button aria-label={`${product.title} ${isActive ? "판매 일시중지" : "판매 공개"}`} aria-pressed={isActive} className="grid min-h-11 min-w-11 shrink-0 place-items-center" disabled={busy || !permissions.canMutate || (isActive ? !manageable : !canPublishStore || product.status !== "pending")} onClick={() => void (isActive ? pause(product) : publish(product))} type="button"><span className={`relative h-6 w-11 rounded-full transition ${isActive ? "bg-emerald-500" : "bg-zinc-300"}`}><span className={`absolute top-1 size-4 rounded-full bg-white transition-transform ${isActive ? "translate-x-5" : "translate-x-1"}`} /></span></button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
              <button className="min-h-11 rounded-xl border border-line px-3 text-xs font-bold disabled:opacity-40 sm:flex-1" disabled={busy || !permissions.canMutate || !manageable} onClick={() => edit(product)} type="button">수정</button>
              {isActive && <Link className="grid min-h-11 place-items-center rounded-xl border border-line px-3 text-xs font-bold sm:flex-1" href={`/auction/${product.id}`}>보기</Link>}
              <button aria-label={`${product.title} 삭제`} className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-red-300 bg-red-50 px-3 text-xs font-bold text-red-700 disabled:opacity-40 sm:col-span-1 sm:flex-1" disabled={busy || !permissions.canMutate || !manageable} onClick={() => void remove(product)} type="button"><Trash2 size={14} /> 삭제</button>
            </div>
          </article>;
        })}
        {visibleProducts.length === 0 && <p className="py-16 text-center text-sm text-muted">조건에 맞는 상품이 없습니다.</p>}
      </div>
      <div className="hidden overflow-x-auto border-y border-line md:block">
        <table className="w-full min-w-[1080px] text-left text-xs">
          <thead className="border-b border-line bg-surface text-[10px] tracking-[.12em] text-muted">
            <tr>
              {view === "registration" && <th className="px-4 py-4">선택</th>}
              <th className="px-4 py-4">상품</th>
              <th className="px-4 py-4">숍</th>
              <th className="px-4 py-4">판매 방식</th>
              <th className="px-4 py-4">가격</th>
              <th className="px-4 py-4">보관</th>
              <th className="px-4 py-4">상태</th>
              {view === "registration" && (
                <th className="px-4 py-4">공개 예정 시각</th>
              )}
              <th className="px-4 py-4" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibleProducts.map((product) => {
              const manageable = isManageableProductStatus(product.status);
              const scheduled = isScheduledProduct(product);
              const overdue = isOverdueScheduledProduct(
                product,
                productReferenceNow,
              );
              const canPublishStore = stores.some(
                (store) => store.id === product.store_id && store.canPublish,
              );
              return (
                <tr key={product.id}>
                  {view === "registration" && (
                    <td className="px-4 py-4">
                      <input
                        aria-label={`${product.title} 공개 선택`}
                        checked={selectedPendingIds.has(product.id)}
                        disabled={
                          busy ||
                          !canPublishStore ||
                          product.status !== "pending"
                        }
                        onChange={() => togglePending(product.id)}
                        type="checkbox"
                      />
                    </td>
                  )}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-3">
                      <CatalogImage
                        alt=""
                        className="size-12 object-cover"
                        src={product.image_urls?.[0] ?? ""}
                      />
                      <span className="font-bold">{product.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-muted">
                    {product.stores?.name ?? "미지정"}
                  </td>
                  <td className="px-4 py-4">
                    {product.sale_type === "fixed" ? "즉시구매" : "경매"}
                  </td>
                  <td className="px-4 py-4 font-mono">
                    {(
                      product.fixed_price ?? product.current_price
                    ).toLocaleString("ko-KR")}
                    원
                  </td>
                  <td className="px-4 py-4">
                    {product.storage_class === "large"
                      ? "대형 · 7일"
                      : "소형 · 14일"}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`border px-2 py-1 text-[10px] font-bold ${product.status === "closed" && product.pending_lock_kind ? "border-amber-300 bg-amber-500/10 text-amber-800" : "border-line"}`}
                    >
                      {view === "registration" &&
                      scheduled
                        ? overdue
                          ? "공개 지연"
                          : "예약 공개"
                        : productStatusText(product)}
                    </span>
                  </td>
                  {view === "registration" && (
                    <td
                      className={`px-4 py-4 font-mono text-[11px] ${overdue ? "font-bold text-red-700" : "text-muted"}`}
                    >
                      {scheduled
                        ? formatScheduledPublishAt(product.publish_at)
                        : product.paused_at
                          ? "운영자 일시중지"
                          : "시각 확인 필요"}
                    </td>
                  )}
                  <td className="px-4 py-4 text-right">
                    <div className="flex justify-end gap-3">
                      {product.status === "active" && (
                        <button
                          aria-label={`${product.title} 일시중지`}
                          className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={busy || !permissions.canMutate}
                          onClick={() => void pause(product)}
                          type="button"
                        >
                          <PauseCircle size={13} /> 일시중지
                        </button>
                      )}
                      {product.status === "pending" && (
                        <button
                          aria-label={`${product.title} 공개`}
                          className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={busy || !canPublishStore}
                          onClick={() => void publish(product)}
                          type="button"
                        >
                          <PlayCircle size={13} /> 공개
                        </button>
                      )}
                      <button
                        aria-label={`${product.title} 점검`}
                        className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || !permissions.canMutate || !manageable}
                        onClick={() => edit(product, "inspection")}
                        type="button"
                      >
                        <ClipboardCheck size={13} /> 점검
                      </button>
                      <button
                        aria-label={`${product.title} 수정`}
                        className="inline-flex items-center gap-1 underline disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || !permissions.canMutate || !manageable}
                        onClick={() => edit(product)}
                        type="button"
                      >
                        <Edit3 size={13} /> 수정
                      </button>
                      <button
                        aria-label={`${product.title} 삭제`}
                        className="inline-flex items-center gap-1 text-red-700 underline disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || !permissions.canMutate || !manageable}
                        onClick={() => void remove(product)}
                        type="button"
                      >
                        <Trash2 size={13} /> 삭제
                      </button>
                      {product.status === "active" && (
                        <Link
                          className="underline"
                          href={`/auction/${product.id}`}
                        >
                          보기
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visibleProducts.length === 0 && (
              <tr>
                <td
                  className="px-4 py-16 text-center text-muted"
                  colSpan={view === "registration" ? 9 : 7}
                >
                  조건에 맞는 상품이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <PremiumDialog
        ariaLabel="단품 등록 결과"
        closeDisabled={registrationResult?.kind === "retrying"}
        labelledBy="single-registration-result-title"
        onClose={() => setRegistrationResult(null)}
        open={registrationResult !== null}
        panelClassName="max-w-sm"
      >
        {registrationResult?.kind === "success" && (
          <div className="space-y-5 p-6 text-center">
            <CheckCircle2
              aria-hidden="true"
              className="mx-auto text-emerald-600"
              size={40}
            />
            <div>
              <h2
                className="text-lg font-black tracking-[-.04em]"
                id="single-registration-result-title"
              >
                등록 완료
              </h2>
              <p className="mt-2 break-keep text-xs leading-5 text-muted">
                “{registrationResult.title}” 상품 등록을 마쳤습니다.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => setRegistrationResult(null)}
              type="button"
              variant="primary"
            >
              확인
            </Button>
          </div>
        )}
        {registrationResult?.kind === "retrying" && (
          <div className="space-y-5 p-6 text-center">
            <RefreshCw
              aria-hidden="true"
              className="mx-auto animate-spin text-ink"
              size={36}
            />
            <div>
              <h2
                className="text-lg font-black tracking-[-.04em]"
                id="single-registration-result-title"
              >
                재시도 진행 중입니다
              </h2>
              <p className="mt-2 break-keep text-xs leading-5 text-muted">
                “{registrationResult.title}” 등록을 다시 시도하고 있습니다.
                잠시만 기다려 주세요.
              </p>
            </div>
          </div>
        )}
        {registrationResult?.kind === "failure" && (
          <div className="space-y-5 p-6 text-center">
            <AlertTriangle
              aria-hidden="true"
              className="mx-auto text-red-700"
              size={40}
            />
            <div>
              <h2
                className="text-lg font-black tracking-[-.04em]"
                id="single-registration-result-title"
              >
                등록 실패
              </h2>
              <p className="mt-2 break-keep text-xs leading-5 text-muted">
                “{registrationResult.title}” 등록을 완료하지 못했습니다. 입력
                내용과 사진을 그대로 두고 다시 시도할 수 있습니다.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() =>
                  retrySingleRegistration(registrationResult.jobId)
                }
                type="button"
                variant="primary"
              >
                재시도
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  restoreFailedRegistration(registrationResult.jobId)
                }
                type="button"
                variant="outline"
              >
                확인
              </Button>
            </div>
          </div>
        )}
      </PremiumDialog>
      <OperatorXlsxImportModal
        accessToken={token ?? ""}
        activeStoreId={
          storeScope.storeId ?? (stores.length === 1 ? stores[0].id : null)
        }
        onClose={() => setXlsxImportOpen(false)}
        onSubmit={importXlsx}
        open={
          view === "registration" && xlsxImportOpen && permissions.canCreate
        }
        stores={stores}
      />
    </div>
  );
}
