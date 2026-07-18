"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 원격 상품 이미지를 표시합니다. */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import Button from "@/src/components/common/Button";
import Modal from "@/src/components/common/Modal";
import {
  deleteManagedProduct,
  fetchManagedProducts,
  publishPendingProductsNow,
  type ManagedProduct,
  updateManagedProduct,
} from "@/src/lib/supabase/products";
import {
  addMemberWarning,
  adjustMemberShippingCredits,
  deleteManagedMember,
  getStaffMemberDirectory,
  setMemberAccessRole,
  setMemberAccountStatus,
  updateManagedMember,
  type ManagedAccessRole,
  type MemberAccountStatus,
  type StaffMemberDirectoryEntry,
} from "@/src/lib/supabase/operations";
import { formatKRW } from "@/src/utils/formatters";
import {
  getPendingNicknameChangeRequests,
  reviewNicknameChangeRequest,
  type PendingNicknameChangeRequest,
} from "@/src/lib/supabase/nickname";

import { CollapsibleSection } from "./CollapsibleSection";
import type { ProductEditValues } from "./ProductEditModal";

const ManualBankTransferPanel = lazy(() =>
  import("./ManualBankTransferPanel").then((module) => ({
    default: module.ManualBankTransferPanel,
  })),
);
const RevenuePanel = lazy(() =>
  import("./RevenuePanel").then((module) => ({
    default: module.RevenuePanel,
  })),
);
const ShippingWorkPanel = lazy(() =>
  import("./ShippingWorkPanel").then((module) => ({
    default: module.ShippingWorkPanel,
  })),
);
const ProductEditModal = lazy(() =>
  import("./ProductEditModal").then((module) => ({
    default: module.ProductEditModal,
  })),
);

export interface AdminPageProps {
  role: "admin" | "operator";
  onCreateProduct: () => void;
  onOpenBulkImport: () => void;
  onProductsChanged: () => void | Promise<void>;
  onNotify?: (message: string) => void;
}

type LoadStatus = "idle" | "loading" | "success" | "error";
type MemberStatusFilter = "all" | MemberAccountStatus;
type MemberGenderFilter = "all" | "female" | "male" | "unknown";
type ProductStatusFilter = "all" | ManagedProduct["status"];

const MEMBER_PAGE_SIZE = 12;
const PRODUCT_PAGE_SIZE = 10;

function DeferredPanelFallback({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-4"
    >
      <span className="sr-only">{label} 불러오는 중</span>
      <div className="commerce-skeleton h-4 w-32 rounded" />
      <div className="commerce-skeleton h-20 rounded-lg" />
    </div>
  );
}

const productStatusLabel: Record<ManagedProduct["status"], string> = {
  pending: "공개 대기",
  active: "진행 중",
  closed: "마감",
};

const productStatusClasses: Record<ManagedProduct["status"], string> = {
  pending:
    "border-[var(--warning-text)]/25 bg-[var(--warning-surface)] text-[var(--warning-text)]",
  active:
    "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]",
  closed:
    "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--text-muted)]",
};

const memberRoleLabel: Record<ManagedAccessRole, string> = {
  operator: "운영자",
  employee: "직원",
  band_member: "밴드 기존 회원",
  member: "일반 회원",
};

const operationSections = [
  ["operations-registration", "상품 등록", "01"],
  ["operations-products", "상품 관리", "02"],
  ["operations-shipping", "배송 대기", "03"],
  ["operations-payments", "입금 확인", "04"],
  ["operations-overview", "운영 현황", "05"],
  ["operations-revenue", "매출 현황", "06"],
  ["operations-members", "회원 관리", "07"],
] as const;

type OperationSectionId = (typeof operationSections)[number][0];

function OperationSectionIcon({ section }: { section: OperationSectionId }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    className: "size-4",
  };

  switch (section) {
    case "operations-registration":
      return <svg {...common}><path d="M12 3v12m0-12L7.5 7.5M12 3l4.5 4.5M4 14v5h16v-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "operations-products":
      return <svg {...common}><path d="M4 7.5h16v12H4zM8 4.5h8l2 3H6l2-3Z" strokeLinejoin="round" /><path d="M9 12h6" strokeLinecap="round" /></svg>;
    case "operations-shipping":
      return <svg {...common}><path d="M3.5 7.5h11v9h-11zM14.5 10h3l3 3v3.5h-6z" strokeLinejoin="round" /><circle cx="7" cy="18" r="1.5" /><circle cx="17.5" cy="18" r="1.5" /></svg>;
    case "operations-payments":
      return <svg {...common}><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M3.5 10h17M7 14h3" strokeLinecap="round" /></svg>;
    case "operations-overview":
      return <svg {...common}><path d="M4 19V9h4v10H4Zm6 0V4h4v15h-4Zm6 0v-7h4v7h-4Z" strokeLinejoin="round" /></svg>;
    case "operations-revenue":
      return <svg {...common}><path d="M4 17.5 9 12l3.5 3 7-8" strokeLinecap="round" strokeLinejoin="round" /><path d="M15.5 7h4v4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "operations-members":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.4-3.5 2.2-5.5 5.5-5.5s5.1 2 5.5 5.5M15 6.5a3 3 0 0 1 0 5.5M16 14c2.5.3 4 2 4.5 5" strokeLinecap="round" /></svg>;
  }
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "확인 필요";

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function MemberInitial({ member }: { member: StaffMemberDirectoryEntry }) {
  const label = member.displayName?.trim() || member.email?.trim() || "회원";
  return (
    <span
      aria-hidden="true"
      className="grid size-9 shrink-0 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-xs font-black text-[var(--text-strong)]"
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav
      aria-label="목록 페이지 이동"
      className="mt-5 flex items-center justify-center gap-2"
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        이전
      </Button>
      <span className="min-w-20 text-center font-mono text-xs font-bold tabular-nums text-[var(--text-muted)]">
        {currentPage} / {totalPages}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        다음
      </Button>
    </nav>
  );
}

function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="목록을 불러오는 중"
      className="mt-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]"
    >
      <span className="sr-only">목록을 불러오는 중입니다.</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0"
        >
          <span className="commerce-skeleton size-9 shrink-0 rounded-lg" />
          <span className="commerce-skeleton h-3.5 w-32 rounded" />
          <span className="commerce-skeleton ml-auto hidden h-3 w-52 rounded sm:block" />
        </div>
      ))}
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="mt-4 grid min-h-40 place-items-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)]/55 px-5 py-8 text-center">
      <div className="max-w-sm">
        <span
          aria-hidden="true"
          className="mx-auto grid size-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text-muted)]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4.5">
            <path d="M4 7.5h16v11H4zM8 4.5h8l2 3H6l2-3Z" strokeLinejoin="round" />
            <path d="M9 12h6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="mt-3 text-sm font-black text-[var(--text-strong)]">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  );
}

export function AdminPage({
  role,
  onCreateProduct,
  onOpenBulkImport,
  onProductsChanged,
  onNotify,
}: AdminPageProps) {
  const [activeSection, setActiveSection] = useState<OperationSectionId>(
    "operations-registration",
  );
  const [visitedSections, setVisitedSections] = useState<
    Set<OperationSectionId>
  >(() => new Set(["operations-registration"]));
  const [members, setMembers] = useState<StaffMemberDirectoryEntry[]>([]);
  const [memberLoadStatus, setMemberLoadStatus] = useState<LoadStatus>("idle");
  const [memberError, setMemberError] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberStatusFilter, setMemberStatusFilter] =
    useState<MemberStatusFilter>("all");
  const [memberGenderFilter, setMemberGenderFilter] =
    useState<MemberGenderFilter>("all");
  const [memberPage, setMemberPage] = useState(1);
  const [mutatingMemberId, setMutatingMemberId] = useState<string | null>(null);
  const [editingMember, setEditingMember] =
    useState<StaffMemberDirectoryEntry | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [warningMember, setWarningMember] =
    useState<StaffMemberDirectoryEntry | null>(null);
  const [warningCategory, setWarningCategory] = useState<
    "general" | "late_payment"
  >("general");
  const [warningReason, setWarningReason] = useState("");
  const [deletingMember, setDeletingMember] =
    useState<StaffMemberDirectoryEntry | null>(null);
  const [memberActionError, setMemberActionError] = useState("");
  const [nicknameRequests, setNicknameRequests] = useState<
    PendingNicknameChangeRequest[]
  >([]);
  const [nicknameRequestError, setNicknameRequestError] = useState("");
  const [reviewingNicknameRequestId, setReviewingNicknameRequestId] = useState<
    string | null
  >(null);

  const [products, setProducts] = useState<ManagedProduct[]>([]);
  const [productLoadStatus, setProductLoadStatus] =
    useState<LoadStatus>("idle");
  const [productError, setProductError] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [productStatusFilter, setProductStatusFilter] =
    useState<ProductStatusFilter>("pending");
  const [productPage, setProductPage] = useState(1);
  const [editingProduct, setEditingProduct] = useState<ManagedProduct | null>(
    null,
  );
  const [deletingProduct, setDeletingProduct] = useState<ManagedProduct | null>(
    null,
  );
  const [isDeletingProduct, setIsDeletingProduct] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [selectedPendingProductIds, setSelectedPendingProductIds] = useState<
    Set<string>
  >(new Set());
  const [isPublishingProducts, setIsPublishingProducts] = useState(false);
  const [publishFeedback, setPublishFeedback] = useState<{
    tone: "success" | "partial" | "error";
    message: string;
  } | null>(null);
  const selectAllPendingRef = useRef<HTMLInputElement>(null);

  const hasOwnerAccess = role === "admin";

  const openOperationSection = (section: OperationSectionId) => {
    setActiveSection(section);
    setVisitedSections((current) => {
      if (current.has(section)) return current;
      const next = new Set(current);
      next.add(section);
      return next;
    });
  };

  const handleOperationTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    section: OperationSectionId,
  ) => {
    const currentIndex = operationSections.findIndex(
      ([sectionId]) => sectionId === section,
    );
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % operationSections.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex =
        (currentIndex - 1 + operationSections.length) %
        operationSections.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = operationSections.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextSection = operationSections[nextIndex][0];
    openOperationSection(nextSection);
    document.getElementById(`${nextSection}-tab`)?.focus();
  };

  const loadMembers = useCallback(async () => {
    setMemberLoadStatus("loading");
    setMemberError("");
    try {
      const directory = await getStaffMemberDirectory();
      setMembers(directory);
      setMemberLoadStatus("success");
    } catch (error) {
      setMemberLoadStatus("error");
      setMemberError(
        getErrorMessage(
          error,
          "회원 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        ),
      );
    }
  }, []);

  const loadNicknameRequests = useCallback(async () => {
    setNicknameRequestError("");
    try {
      setNicknameRequests(await getPendingNicknameChangeRequests());
    } catch (error) {
      setNicknameRequestError(
        getErrorMessage(error, "닉네임 승인 요청을 불러오지 못했습니다."),
      );
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setProductLoadStatus("loading");
    setProductError("");
    try {
      const managedProducts = await fetchManagedProducts();
      setProducts(managedProducts);
      const pendingIds = new Set(
        managedProducts
          .filter((product) => product.status === "pending")
          .map((product) => product.id),
      );
      setSelectedPendingProductIds((current) => {
        const next = new Set([...current].filter((id) => pendingIds.has(id)));
        return next.size === current.size ? current : next;
      });
      setProductLoadStatus("success");
    } catch (error) {
      setProductLoadStatus("error");
      setProductError(
        getErrorMessage(
          error,
          "상품 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
        ),
      );
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadMembers();
      void loadNicknameRequests();
      void loadProducts();
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [loadMembers, loadNicknameRequests, loadProducts]);

  const directoryMembers = useMemo(
    () =>
      hasOwnerAccess
        ? members
        : members.filter((member) => member.accessRole !== "operator"),
    [hasOwnerAccess, members],
  );

  const filteredMembers = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase("ko-KR");
    return directoryMembers.filter((member) => {
      if (
        memberStatusFilter !== "all" &&
        member.accountStatus !== memberStatusFilter
      ) {
        return false;
      }
      if (
        memberGenderFilter !== "all" &&
        (memberGenderFilter === "unknown"
          ? member.gender !== null
          : member.gender !== memberGenderFilter)
      ) {
        return false;
      }
      if (!query) return true;
      return [
        member.displayName,
        member.legalName,
        member.email,
        member.phone,
        member.birthYear?.toString(),
        member.id,
      ].some((value) => value?.toLocaleLowerCase("ko-KR").includes(query));
    });
  }, [directoryMembers, memberGenderFilter, memberQuery, memberStatusFilter]);

  const memberTotalPages = Math.max(
    1,
    Math.ceil(filteredMembers.length / MEMBER_PAGE_SIZE),
  );
  const safeMemberPage = Math.min(memberPage, memberTotalPages);
  const pagedMembers = filteredMembers.slice(
    (safeMemberPage - 1) * MEMBER_PAGE_SIZE,
    safeMemberPage * MEMBER_PAGE_SIZE,
  );

  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLocaleLowerCase("ko-KR");
    return products.filter((product) => {
      if (
        productStatusFilter !== "all" &&
        product.status !== productStatusFilter
      ) {
        return false;
      }
      if (!query) return true;
      return [product.title, product.description, product.id].some((value) =>
        value.toLocaleLowerCase("ko-KR").includes(query),
      );
    });
  }, [productQuery, productStatusFilter, products]);

  const productTotalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / PRODUCT_PAGE_SIZE),
  );
  const safeProductPage = Math.min(productPage, productTotalPages);
  const pagedProducts = filteredProducts.slice(
    (safeProductPage - 1) * PRODUCT_PAGE_SIZE,
    safeProductPage * PRODUCT_PAGE_SIZE,
  );
  const pendingFilteredProductIds = filteredProducts
    .filter((product) => product.status === "pending")
    .map((product) => product.id);
  const selectablePendingProductIds = pendingFilteredProductIds.slice(0, 200);
  const areAllPendingProductsSelected =
    selectablePendingProductIds.length > 0 &&
    selectablePendingProductIds.every((id) =>
      selectedPendingProductIds.has(id),
    );
  const areSomePendingProductsSelected = selectablePendingProductIds.some(
    (id) => selectedPendingProductIds.has(id),
  );

  useEffect(() => {
    if (selectAllPendingRef.current) {
      selectAllPendingRef.current.indeterminate =
        areSomePendingProductsSelected && !areAllPendingProductsSelected;
    }
  }, [areAllPendingProductsSelected, areSomePendingProductsSelected]);

  const activeMemberCount = directoryMembers.filter(
    (member) => member.accountStatus === "active",
  ).length;
  const suspendedMemberCount = directoryMembers.length - activeMemberCount;
  const activeProductCount = products.filter(
    (product) => product.status === "active",
  ).length;
  const pendingProductCount = products.filter(
    (product) => product.status === "pending",
  ).length;

  const handleMemberStatusChange = async (
    member: StaffMemberDirectoryEntry,
    status: MemberAccountStatus,
  ) => {
    if (member.accountStatus === status) return;
    setMutatingMemberId(member.id);
    setMemberError("");
    try {
      const updatedStatus = await setMemberAccountStatus(member.id, status);
      setMembers((current) =>
        current.map((entry) =>
          entry.id === member.id
            ? { ...entry, accountStatus: updatedStatus }
            : entry,
        ),
      );
      onNotify?.(
        status === "active"
          ? "회원 계정을 다시 활성화했습니다."
          : "회원 계정을 이용 정지했습니다.",
      );
    } catch (error) {
      setMemberError(
        getErrorMessage(error, "회원 상태를 변경하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const handleShippingCreditChange = async (
    member: StaffMemberDirectoryEntry,
    delta: number,
  ) => {
    if (delta < 0 && member.shippingCreditCount <= 0) return;
    setMutatingMemberId(member.id);
    setMemberError("");
    try {
      const updatedCreditCount = await adjustMemberShippingCredits(
        member.id,
        delta,
      );
      setMembers((current) =>
        current.map((entry) =>
          entry.id === member.id
            ? {
                ...entry,
                shippingCreditCount: updatedCreditCount,
              }
            : entry,
        ),
      );
      onNotify?.(
        `배송 이용권을 ${delta > 0 ? "1개 추가" : "1개 차감"}했습니다.`,
      );
    } catch (error) {
      setMemberError(
        getErrorMessage(error, "배송 이용권을 변경하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const handleMemberRoleChange = async (
    member: StaffMemberDirectoryEntry,
    nextRole: ManagedAccessRole,
  ) => {
    if (member.accessRole === nextRole) return;
    if (nextRole === "operator" && !hasOwnerAccess) return;
    setMutatingMemberId(member.id);
    setMemberError("");
    try {
      await setMemberAccessRole(member.id, nextRole);
      if (nextRole === "operator" && hasOwnerAccess) {
        setMembers((current) =>
          current.map((entry) =>
            entry.id === member.id ? { ...entry, accessRole: nextRole } : entry,
          ),
        );
      } else {
        setMembers((current) =>
          current.map((entry) =>
            entry.id === member.id ? { ...entry, accessRole: nextRole } : entry,
          ),
        );
      }
      onNotify?.(`회원 권한을 ${memberRoleLabel[nextRole]}로 변경했습니다.`);
    } catch (error) {
      setMemberError(
        getErrorMessage(error, "회원 권한을 변경하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const openMemberEdit = (member: StaffMemberDirectoryEntry) => {
    setEditingMember(member);
    setEditPhone(member.phone ?? "");
    setMemberActionError("");
  };

  const saveMemberEdit = async () => {
    if (!editingMember) return;
    setMutatingMemberId(editingMember.id);
    setMemberActionError("");
    try {
      await updateManagedMember(
        editingMember.id,
        editingMember.displayName ?? "회원",
        editPhone,
      );
      setMembers((current) =>
        current.map((entry) =>
          entry.id === editingMember.id
            ? { ...entry, phone: editPhone.trim() || null }
            : entry,
        ),
      );
      setEditingMember(null);
      onNotify?.("회원 정보를 수정했습니다.");
    } catch (error) {
      setMemberActionError(
        getErrorMessage(error, "회원 정보를 수정하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const handleNicknameReview = async (
    request: PendingNicknameChangeRequest,
    approve: boolean,
  ) => {
    setReviewingNicknameRequestId(request.id);
    setNicknameRequestError("");
    try {
      await reviewNicknameChangeRequest(request.id, approve);
      setNicknameRequests((current) =>
        current.filter((item) => item.id !== request.id),
      );
      if (approve) {
        setMembers((current) =>
          current.map((member) =>
            member.id === request.memberId
              ? { ...member, displayName: request.requestedNickname }
              : member,
          ),
        );
      }
      onNotify?.(
        approve ? "닉네임 변경을 승인했습니다." : "닉네임 변경을 반려했습니다.",
      );
    } catch (error) {
      setNicknameRequestError(
        getErrorMessage(error, "닉네임 요청을 처리하지 못했습니다."),
      );
    } finally {
      setReviewingNicknameRequestId(null);
    }
  };

  const submitWarning = async () => {
    if (!warningMember) return;
    setMutatingMemberId(warningMember.id);
    setMemberActionError("");
    try {
      const result = await addMemberWarning(
        warningMember.id,
        warningCategory,
        warningReason,
      );
      setMembers((current) =>
        current.map((entry) =>
          entry.id === warningMember.id
            ? {
                ...entry,
                warningCount: result.warningCount,
                sanctionCount: result.sanctionCount,
                bidBlockedUntil: result.bidBlockedUntil,
              }
            : entry,
        ),
      );
      setWarningMember(null);
      setWarningReason("");
      onNotify?.(
        result.cancelledBidCount > 0
          ? `경고와 제재를 적용하고 진행 중 입찰 ${result.cancelledBidCount}건을 취소했습니다.`
          : warningCategory === "late_payment" &&
              warningMember.paymentDeadlineExempt
            ? "밴드 기존 회원의 결제 지연 면제를 유지했습니다."
            : "회원 경고를 등록했습니다.",
      );
    } catch (error) {
      setMemberActionError(
        getErrorMessage(error, "경고를 등록하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const confirmMemberDelete = async () => {
    if (!deletingMember) return;
    setMutatingMemberId(deletingMember.id);
    setMemberActionError("");
    try {
      await deleteManagedMember(deletingMember.id);
      setMembers((current) =>
        current.filter((entry) => entry.id !== deletingMember.id),
      );
      setDeletingMember(null);
      onNotify?.("회원 계정을 삭제했습니다.");
    } catch (error) {
      setMemberActionError(
        getErrorMessage(error, "회원 계정을 삭제하지 못했습니다."),
      );
    } finally {
      setMutatingMemberId(null);
    }
  };

  const handleProductSave = async (
    productId: string,
    values: ProductEditValues,
  ) => {
    const currentProduct = products.find((product) => product.id === productId);
    if (!currentProduct) {
      throw new Error(
        "수정할 상품을 찾지 못했습니다. 목록을 새로고침해 주세요.",
      );
    }

    const updatedProduct = await updateManagedProduct(productId, {
      title: values.title,
      description: values.description,
      startingPrice: values.startingPrice,
      bidIncrement: currentProduct.bidIncrement,
      status: values.status,
      publishAt: values.publishAt,
      expectedUpdatedAt: currentProduct.updatedAt,
    });

    setProducts((current) =>
      current.map((product) =>
        product.id === productId ? updatedProduct : product,
      ),
    );
    onNotify?.("상품 정보를 수정했습니다.");

    try {
      await onProductsChanged();
    } catch {
      setProductError(
        "상품은 수정되었지만 공개 피드를 바로 갱신하지 못했습니다. 목록 새로고침을 눌러 주세요.",
      );
    }
  };

  const handleProductDelete = async () => {
    if (!deletingProduct) return;
    setIsDeletingProduct(true);
    setDeleteError("");
    try {
      await deleteManagedProduct(deletingProduct.id, deletingProduct.updatedAt);
      setProducts((current) =>
        current.filter((product) => product.id !== deletingProduct.id),
      );
      setEditingProduct((current) =>
        current?.id === deletingProduct.id ? null : current,
      );
      setDeletingProduct(null);
      onNotify?.("상품을 삭제했습니다.");
      try {
        await onProductsChanged();
      } catch {
        setProductError(
          "상품은 삭제되었지만 공개 피드를 바로 갱신하지 못했습니다. 목록 새로고침을 눌러 주세요.",
        );
      }
    } catch (error) {
      setDeleteError(getErrorMessage(error, "상품을 삭제하지 못했습니다."));
    } finally {
      setIsDeletingProduct(false);
    }
  };

  const togglePendingProductSelection = (productId: string) => {
    setPublishFeedback(null);
    if (
      !selectedPendingProductIds.has(productId) &&
      selectedPendingProductIds.size >= 200
    ) {
      setPublishFeedback({
        tone: "error",
        message: "한 번에 최대 200개 상품까지 선택할 수 있습니다.",
      });
      return;
    }
    setSelectedPendingProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleAllPendingProducts = () => {
    setPublishFeedback(null);
    setSelectedPendingProductIds((current) => {
      if (areAllPendingProductsSelected) {
        const next = new Set(current);
        selectablePendingProductIds.forEach((id) => next.delete(id));
        return next;
      }

      return new Set(selectablePendingProductIds);
    });

    if (pendingFilteredProductIds.length > 200) {
      setPublishFeedback({
        tone: "partial",
        message:
          "검색 결과가 200개를 넘어 앞의 200개만 선택했습니다. 먼저 공개한 뒤 나머지를 선택해 주세요.",
      });
    }
  };

  const handlePublishPendingProducts = async () => {
    if (selectedPendingProductIds.size === 0 || isPublishingProducts) return;
    setIsPublishingProducts(true);
    setPublishFeedback(null);
    try {
      const result = await publishPendingProductsNow([
        ...selectedPendingProductIds,
      ]);
      const message =
        result.skippedCount > 0
          ? `${result.publishedCount}개를 즉시 공개했고, 이미 상태가 바뀌었거나 찾을 수 없는 ${result.skippedCount}개는 건너뛰었습니다.`
          : `${result.publishedCount}개 상품을 지금 공개했습니다.`;

      setPublishFeedback({
        tone: result.skippedCount > 0 ? "partial" : "success",
        message,
      });
      setSelectedPendingProductIds(new Set());
      await loadProducts();
      onNotify?.(message);
      try {
        await onProductsChanged();
      } catch {
        setPublishFeedback({
          tone: "partial",
          message: `${message} 공개 피드는 잠시 후 자동으로 갱신됩니다.`,
        });
      }
    } catch (error) {
      setPublishFeedback({
        tone: "error",
        message: getErrorMessage(
          error,
          "선택한 대기 상품을 즉시 공개하지 못했습니다.",
        ),
      });
    } finally {
      setIsPublishingProducts(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 sm:pt-7 lg:px-7 lg:pb-12">
      <header className="mb-5 flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-glass)] px-4 py-5 shadow-[var(--panel-shadow)] backdrop-blur-xl sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div>
          <p className="text-[10px] font-black tracking-[0.2em] text-[var(--accent-text)]">
            OPERATIONS CENTER
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] text-[var(--text-strong)] sm:text-3xl">
            운영자 페이지
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm font-semibold leading-6 text-[var(--text-muted)]">
            회원과 경매 상품을 실제 서버 데이터로 조회하고, 필요한 업무만 선택해서
            처리합니다.
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs font-black text-[var(--text-muted)] shadow-sm">
          <span className="size-1.5 rounded-full bg-[var(--success-text)]" aria-hidden="true" />
          운영 센터 · 운영자
        </span>
      </header>

      <div className="lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:items-start lg:gap-5">
        <aside className="sticky top-[calc(env(safe-area-inset-top)+.5rem)] z-30 mb-4 touch-pan-x overflow-x-auto overscroll-x-contain scroll-smooth rounded-xl border border-zinc-800 bg-zinc-950 p-2 text-zinc-400 shadow-[0_18px_44px_rgba(0,0,0,0.22)] lg:top-20 lg:z-10 lg:mb-0 lg:overflow-visible">
          <p className="hidden px-3 pb-2 pt-2 font-mono text-[10px] font-black uppercase tabular-nums tracking-[0.18em] text-zinc-500 lg:block">
            Workspace
          </p>
          <nav aria-label="운영 센터 업무 선택" role="tablist" className="flex min-w-max snap-x snap-mandatory gap-1 lg:min-w-0 lg:flex-col lg:snap-none">
            {operationSections.map(([href, label, index]) => (
              <button
                key={href}
                id={`${href}-tab`}
                type="button"
                role="tab"
                aria-selected={activeSection === href}
                aria-current={activeSection === href ? "page" : undefined}
                aria-controls={href}
                tabIndex={activeSection === href ? 0 : -1}
                onClick={() => openOperationSection(href)}
                onKeyDown={(event) => handleOperationTabKeyDown(event, href)}
                className={`group flex min-h-12 shrink-0 snap-start items-center gap-2.5 rounded-r-lg border-l-2 px-3 py-2 text-left text-xs font-bold transition-all duration-200 ease-out active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 lg:min-h-10 ${
                  activeSection === href
                    ? "border-l-2 border-white bg-zinc-800/60 text-white shadow-sm"
                    : "border-transparent text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                }`}
              >
                <span className="text-zinc-500 transition-colors group-hover:text-zinc-200" aria-hidden="true">
                  <OperationSectionIcon section={href} />
                </span>
                <span className="min-w-0 flex-1 whitespace-nowrap">{label}</span>
                <span className="font-mono text-[9px] font-black tabular-nums text-zinc-600">{index}</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
        <CollapsibleSection
          id="operations-overview"
          active={activeSection === "operations-overview"}
          visited={visitedSections.has("operations-overview")}
          eyebrow="OVERVIEW"
          title="운영 현황"
          summary="회원과 상품의 현재 상태를 서버 기준으로 빠르게 확인합니다."
          className="order-5"
        >
          <div
            aria-label="운영 현황 요약"
            className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
          >
            <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md sm:p-4">
              <p className="text-xs font-black text-[var(--text-muted)]">전체 회원</p>
              <p className="mt-1.5 font-mono text-xl font-black tabular-nums tracking-tight text-[var(--text-strong)] sm:text-2xl">
                {memberLoadStatus === "success" ? directoryMembers.length : "—"}
                <span className="ml-1 font-sans text-xs">명</span>
              </p>
              <p className="mt-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
                {memberLoadStatus === "success"
                  ? `활성 ${activeMemberCount} · 정지 ${suspendedMemberCount}`
                  : "회원 데이터를 확인 중"}
              </p>
            </article>
            <article className="rounded-lg border border-[var(--info-border)] bg-[var(--info-surface)] p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md sm:p-4">
              <p className="text-xs font-black text-[var(--info-text)]">진행 중 경매</p>
              <p className="mt-1.5 font-mono text-xl font-black tabular-nums tracking-tight text-[var(--text-strong)] sm:text-2xl">
                {productLoadStatus === "success" ? activeProductCount : "—"}
                <span className="ml-1 font-sans text-xs">개</span>
              </p>
              <p className="mt-1.5 text-[11px] font-semibold text-[var(--info-text)]">
                공개 피드에 노출 중인 상품
              </p>
            </article>
            <article className="rounded-lg border border-[var(--border)] bg-[var(--warning-surface)] p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md sm:p-4">
              <p className="text-xs font-black text-[var(--warning-text)]">공개 대기</p>
              <p className="mt-1.5 font-mono text-xl font-black tabular-nums tracking-tight text-[var(--text-strong)] sm:text-2xl">
                {productLoadStatus === "success" ? pendingProductCount : "—"}
                <span className="ml-1 font-sans text-xs">개</span>
              </p>
              <p className="mt-1.5 text-[11px] font-semibold text-[var(--warning-text)]">
                예약 공개를 기다리는 상품
              </p>
            </article>
            <article className="rounded-lg border border-[var(--border)] bg-[var(--accent-surface)] p-3 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md sm:p-4">
              <p className="text-xs font-black text-[var(--accent-text)]">운영 권한</p>
              <p className="mt-1.5 text-base font-black text-[var(--text-strong)]">
                회원·상품 관리
              </p>
              <p className="mt-1.5 text-[11px] font-semibold leading-5 text-[var(--accent-text)]">
                {hasOwnerAccess
                  ? "운영자 지정까지 포함한 전체 운영 권한"
                  : "회원 상태·등급·배송 이용권 관리"}
              </p>
            </article>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-revenue"
          active={activeSection === "operations-revenue"}
          visited={visitedSections.has("operations-revenue")}
          eyebrow="REVENUE"
          title="매출 현황"
          summary="실제 입금이 확인된 하루 매출만 저장하고 일·주·월·연 단위로 합산합니다."
          className="order-6"
        >
          <Suspense fallback={<DeferredPanelFallback label="매출 현황" />}>
            <RevenuePanel />
          </Suspense>
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-payments"
          active={activeSection === "operations-payments"}
          visited={visitedSections.has("operations-payments")}
          eyebrow="PAYMENTS"
          title="계좌이체·입금 확인"
          summary="사이트 공용 입금 계좌를 설정하고, 회원이 계좌를 확인한 건의 실제 입금을 직접 확정합니다."
          className="order-4"
        >
          <Suspense fallback={<DeferredPanelFallback label="입금 확인" />}>
            <ManualBankTransferPanel />
          </Suspense>
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-shipping"
          active={activeSection === "operations-shipping"}
          visited={visitedSections.has("operations-shipping")}
          eyebrow="SHIPPING"
          title="배송 대기 업무"
          summary="회원이 접수한 상품의 배송지와 운송장 처리 상태를 확인합니다."
          className="order-3"
        >
          <Suspense fallback={<DeferredPanelFallback label="배송 대기 업무" />}>
            <ShippingWorkPanel canAccessCompleted />
          </Suspense>
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-members"
          active={activeSection === "operations-members"}
          visited={visitedSections.has("operations-members")}
          eyebrow="MEMBERS"
          title="회원 관리"
          summary="전체 회원의 계정 상태, 배송 이용권, 상담·입찰 현황을 확인합니다."
          className="order-7"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void loadMembers();
                void loadNicknameRequests();
              }}
              isLoading={memberLoadStatus === "loading"}
            >
              목록 새로고침
            </Button>
          }
        >
          <p className="mb-4 rounded-lg border border-[var(--info-border)] bg-[var(--info-surface)] px-3.5 py-2.5 text-xs font-bold leading-5 text-[var(--info-text)]">
            {hasOwnerAccess
              ? "회원 정보·상태·등급을 관리하고 필요할 때 운영자 권한을 지정할 수 있습니다."
              : "회원 정보·상태·등급과 배송 이용권을 이 화면에서 관리할 수 있습니다."}
          </p>

          <section
            className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)]/55 p-3.5 sm:p-4"
            aria-labelledby="nickname-review-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black tracking-[0.16em] text-[var(--accent-text)]">
                  NICKNAME REVIEW
                </p>
                <h3
                  id="nickname-review-title"
                  className="mt-0.5 text-base font-black text-[var(--text-strong)]"
                >
                  닉네임 변경 승인
                </h3>
              </div>
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs font-black tabular-nums text-[var(--accent-text)]">
                대기 {nicknameRequests.length}건
              </span>
            </div>
            {nicknameRequestError ? (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--danger-surface)] px-3 py-2 text-xs font-bold text-[var(--danger-text)]"
              >
                {nicknameRequestError}
              </p>
            ) : null}
            {nicknameRequests.length === 0 ? (
              <p className="mt-3 text-xs font-semibold text-[var(--text-muted)]">
                현재 승인 대기 요청이 없습니다.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {nicknameRequests.map((request) => {
                  const isReviewing = reviewingNicknameRequestId === request.id;
                  return (
                    <li
                      key={request.id}
                      className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-[var(--text-strong)]">
                          {request.currentNickname}{" "}
                          <span aria-hidden="true">→</span>{" "}
                          <strong className="text-[var(--accent-text)]">
                            {request.requestedNickname}
                          </strong>
                        </p>
                        <p className="mt-1 font-mono text-[11px] font-bold tabular-nums text-[var(--text-muted)]">
                          {formatDateTime(request.requestedAt)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(reviewingNicknameRequestId)}
                          onClick={() =>
                            void handleNicknameReview(request, false)
                          }
                        >
                          반려
                        </Button>
                        <Button
                          size="sm"
                          isLoading={isReviewing}
                          disabled={
                            Boolean(reviewingNicknameRequestId) && !isReviewing
                          }
                          onClick={() =>
                            void handleNicknameReview(request, true)
                          }
                        >
                          승인
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_170px]">
            <label className="text-xs font-black text-[var(--text-strong)]">
              회원 검색
              <input
                type="search"
                value={memberQuery}
                onChange={(event) => {
                  setMemberQuery(event.target.value);
                  setMemberPage(1);
                }}
                placeholder="닉네임, 이름, 출생연도, 연락처 또는 회원 ID"
                className="mt-1.5 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)] sm:min-h-10"
              />
            </label>
            <label className="text-xs font-black text-[var(--text-strong)]">
              계정 상태
              <select
                value={memberStatusFilter}
                onChange={(event) => {
                  setMemberStatusFilter(
                    event.target.value as MemberStatusFilter,
                  );
                  setMemberPage(1);
                }}
                className="mt-1.5 min-h-12 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)] sm:min-h-10"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="suspended">이용 정지</option>
              </select>
            </label>
            <label className="text-xs font-black text-[var(--text-strong)]">
              성별 기준
              <select
                value={memberGenderFilter}
                onChange={(event) => {
                  setMemberGenderFilter(
                    event.target.value as MemberGenderFilter,
                  );
                  setMemberPage(1);
                }}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              >
                <option value="all">전체 성별</option>
                <option value="female">여성</option>
                <option value="male">남성</option>
                <option value="unknown">확인 대기</option>
              </select>
            </label>
          </div>

          {memberError ? (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)] sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{memberError}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadMembers()}
              >
                다시 시도
              </Button>
            </div>
          ) : null}

          {memberLoadStatus === "loading" && members.length === 0 ? (
            <PanelSkeleton />
          ) : pagedMembers.length === 0 ? (
            <EmptyPanel
              title="조건에 맞는 회원이 없습니다"
              description="검색어나 계정 상태 필터를 바꾸면 다른 회원을 확인할 수 있습니다."
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm">
              <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(170px,1fr)_minmax(190px,1fr)_minmax(180px,.8fr)_auto] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)]/70 px-3.5 py-2 font-mono text-[9px] font-black uppercase tabular-nums tracking-[0.12em] text-[var(--text-muted)] xl:grid">
                <span>회원</span>
                <span>프로필 / 접속</span>
                <span>활동 데이터</span>
                <span>권한 / 배송권</span>
                <span className="text-right">작업</span>
              </div>
            <ul className="divide-y divide-[var(--border)]">
              {pagedMembers.map((member) => {
                const isMutating = mutatingMemberId === member.id;
                return (
                  <li
                    key={member.id}
                    className="grid gap-3 p-3 transition-all duration-200 ease-out hover:bg-[var(--surface-muted)]/50 sm:p-3.5 xl:grid-cols-[minmax(220px,1.35fr)_minmax(170px,1fr)_minmax(190px,1fr)_minmax(180px,.8fr)_auto] xl:items-center"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <MemberInitial member={member} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <h3 className="truncate text-sm font-black text-[var(--text-strong)]">
                            {member.displayName || "이름 미설정"}
                          </h3>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-black ${
                              member.accountStatus === "active"
                                ? "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]"
                                : "border-[var(--danger-text)]/25 bg-[var(--danger-surface)] text-[var(--danger-text)]"
                            }`}
                          >
                            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                            {member.accountStatus === "active"
                              ? "활성"
                              : "이용 정지"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] font-semibold text-[var(--text-muted)]">
                          {memberRoleLabel[member.accessRole]} · {member.legalName || "실명 확인 대기"} ·{" "}
                          {member.gender === "female"
                            ? "여성"
                            : member.gender === "male"
                              ? "남성"
                              : "성별 확인 대기"}{" "}
                          ·{" "}
                          {member.birthYear
                            ? `${member.birthYear}년`
                            : "출생연도 확인 대기"}
                        </p>
                        <p className="mt-1 truncate font-mono text-[9px] font-semibold tabular-nums tracking-tight text-[var(--text-muted)]" title={member.id}>
                          ID · {member.id}
                        </p>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {member.supportStatus ? (
                          <span className="rounded-full border border-[var(--info-border)] bg-[var(--info-surface)] px-2 py-1 text-[9px] font-black text-[var(--info-text)]">
                            상담 {member.supportStatus === "open" ? "진행" : "종료"}
                          </span>
                        ) : null}
                        <span className={`rounded-full border px-2 py-1 text-[9px] font-black ${member.kakaoProfileComplete ? "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]" : "border-[var(--warning-text)]/25 bg-[var(--warning-surface)] text-[var(--warning-text)]"}`}>
                          {member.kakaoProfileComplete ? "카카오 확인" : "카카오 대기"}
                        </span>
                      </div>
                      <p className="mt-2 truncate font-mono text-[10px] font-bold tabular-nums text-[var(--text-muted)]" title={member.phone || "미등록"}>
                        TEL · {member.phone || "미등록"}
                      </p>
                      <p className="mt-1 truncate font-mono text-[9px] font-bold tabular-nums text-[var(--text-muted)]" title={formatDateTime(member.lastSeenAt)}>
                        LAST · {formatDateTime(member.lastSeenAt)}
                      </p>
                    </div>

                    <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
                      <div className="bg-[var(--surface)] px-2.5 py-2">
                        <dt className="text-[9px] font-black text-[var(--text-muted)]">배송권</dt>
                        <dd className="mt-0.5 font-mono text-xs font-black tabular-nums text-[var(--text-strong)]">{member.shippingCreditCount}</dd>
                      </div>
                      <div className="bg-[var(--surface)] px-2.5 py-2">
                        <dt className="text-[9px] font-black text-[var(--text-muted)]">배송지</dt>
                        <dd className="mt-0.5 font-mono text-xs font-black tabular-nums text-[var(--text-strong)]">{member.addressCount}</dd>
                      </div>
                      <div className="bg-[var(--surface)] px-2.5 py-2">
                        <dt className="text-[9px] font-black text-[var(--text-muted)]">입찰</dt>
                        <dd className="mt-0.5 font-mono text-xs font-black tabular-nums text-[var(--text-strong)]">{member.bidCount}</dd>
                      </div>
                      <div className="col-span-3 flex items-center justify-between gap-3 bg-[var(--surface)] px-2.5 py-2 text-[9px] font-black text-[var(--text-muted)]">
                        <span>경고 / 제재</span>
                        <span className="font-mono tabular-nums text-[var(--text-strong)]">{member.warningCount} / {member.sanctionCount}</span>
                      </div>
                      <div className="col-span-3 min-w-0 bg-[var(--surface)] px-2.5 py-2">
                        <dt className="text-[9px] font-black text-[var(--text-muted)]">입찰 제한</dt>
                        <dd className="mt-0.5 truncate font-mono text-[9px] font-black tabular-nums text-[var(--text-strong)]" title={formatDateTime(member.bidBlockedUntil)}>
                          {member.bidBlockedUntil ? formatDateTime(member.bidBlockedUntil) : "없음"}
                        </dd>
                      </div>
                    </dl>

                    <div className="space-y-2">
                      <label className="block text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          Access
                          <select
                            aria-label={`${member.displayName || "회원"} 권한`}
                            value={member.accessRole}
                            disabled={isMutating}
                            onChange={(event) =>
                              void handleMemberRoleChange(
                                member,
                                event.target.value as ManagedAccessRole,
                              )
                            }
                            className="mt-1 min-h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-2.5 text-xs font-bold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
                          >
                            {hasOwnerAccess ? (
                              <option value="operator">운영자</option>
                            ) : null}
                            <option value="employee">직원</option>
                            <option value="band_member">밴드 기존 회원</option>
                            <option value="member">일반 회원</option>
                          </select>
                        </label>
                        {member.accessRole !== "operator" ? (
                          <div className="flex items-center gap-2">
                            <span className="mr-auto text-[10px] font-black text-[var(--text-muted)]">배송 이용권</span>
                            <button
                              type="button"
                              aria-label={`${member.displayName || "회원"} 배송 이용권 1개 차감`}
                              disabled={
                                isMutating || member.shippingCreditCount <= 0
                              }
                              onClick={() =>
                                void handleShippingCreditChange(member, -1)
                              }
                            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] font-mono text-sm font-black text-[var(--text-strong)] transition-all duration-200 ease-out hover:border-[var(--border-strong)] active:scale-95 disabled:opacity-40"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              aria-label={`${member.displayName || "회원"} 배송 이용권 1개 추가`}
                              disabled={isMutating}
                              onClick={() =>
                                void handleShippingCreditChange(member, 1)
                              }
                              className="grid size-8 place-items-center rounded-lg border border-[var(--info-border)] bg-[var(--info-surface)] font-mono text-sm font-black text-[var(--info-text)] transition-all duration-200 ease-out active:scale-95 disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>
                        ) : null}
                    </div>

                    {member.accessRole !== "operator" ? (
                        <div className="flex flex-wrap gap-1.5 xl:max-w-48 xl:justify-end">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isMutating}
                            onClick={() => openMemberEdit(member)}
                          >
                            정보 수정
                          </Button>
                          <Button
                            size="sm"
                            variant={
                              member.accountStatus === "active"
                                ? "danger"
                                : "secondary"
                            }
                            isLoading={isMutating}
                            onClick={() =>
                              void handleMemberStatusChange(
                                member,
                                member.accountStatus === "active"
                                  ? "suspended"
                                  : "active",
                              )
                            }
                          >
                            {member.accountStatus === "active"
                              ? "이용 정지"
                              : "계정 활성화"}
                          </Button>
                          {member.accessRole === "member" ||
                          member.accessRole === "band_member" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isMutating}
                              onClick={() => {
                                setWarningMember(member);
                                setWarningCategory("general");
                                setWarningReason("");
                                setMemberActionError("");
                              }}
                            >
                              경고 등록
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isMutating}
                            onClick={() => {
                              setDeletingMember(member);
                              setMemberActionError("");
                            }}
                          >
                            회원 삭제
                          </Button>
                        </div>
                      ) : null}
                  </li>
                );
              })}
            </ul>
            </div>
          )}

          <Pagination
            currentPage={safeMemberPage}
            totalPages={memberTotalPages}
            onPageChange={setMemberPage}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-products"
          active={activeSection === "operations-products"}
          visited={visitedSections.has("operations-products")}
          eyebrow="PRODUCTS"
          title="상품 대기열·관리"
          summary="일괄 등록된 공개 대기 상품을 먼저 검수하고, 잘못된 항목은 공개 전에 수정하거나 삭제합니다. 진행·마감 상품도 상태 필터로 확인할 수 있습니다."
          className="order-2"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadProducts()}
              isLoading={productLoadStatus === "loading"}
            >
              목록 새로고침
            </Button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
            <label className="text-xs font-black text-[var(--text-strong)]">
              상품 검색
              <input
                type="search"
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setProductPage(1);
                }}
                placeholder="상품명, 설명 또는 상품 ID"
                className="mt-1.5 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              />
            </label>
            <label className="text-xs font-black text-[var(--text-strong)]">
              공개 상태
              <select
                value={productStatusFilter}
                onChange={(event) => {
                  setProductStatusFilter(
                    event.target.value as ProductStatusFilter,
                  );
                  setProductPage(1);
                }}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-3 text-sm font-semibold text-[var(--text-strong)] outline-none transition-all duration-200 focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              >
                <option value="all">전체 상태</option>
                <option value="pending">공개 대기</option>
                <option value="active">진행 중</option>
                <option value="closed">마감</option>
              </select>
            </label>
          </div>

          <div
            className={`mt-4 flex flex-col gap-3 rounded-xl border p-3 transition-all duration-200 sm:flex-row sm:items-center sm:justify-between ${
              selectedPendingProductIds.size > 0
                ? "sticky bottom-4 z-20 border-zinc-700 bg-zinc-950 text-white shadow-[0_18px_48px_rgba(0,0,0,0.34)] max-sm:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
                : "border-[var(--border)] bg-[var(--surface-muted)]/60"
            }`}
          >
            <label className={`flex cursor-pointer items-center gap-3 text-xs font-black ${selectedPendingProductIds.size > 0 ? "text-zinc-200" : "text-[var(--text-strong)]"}`}>
              <input
                ref={selectAllPendingRef}
                type="checkbox"
                checked={areAllPendingProductsSelected}
                onChange={toggleAllPendingProducts}
                disabled={
                  selectablePendingProductIds.length === 0 ||
                  isPublishingProducts
                }
                className="size-4 rounded border-[var(--border-strong)] accent-[var(--accent)]"
              />
              검색 결과의 공개 대기 상품 전체 선택
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`font-mono text-xs font-black tabular-nums tracking-tight ${selectedPendingProductIds.size > 0 ? "text-white" : "text-[var(--text-muted)]"}`}>
                {selectedPendingProductIds.size.toLocaleString("ko-KR")}개 선택
              </span>
              {selectedPendingProductIds.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelectedPendingProductIds(new Set())}
                  className="min-h-8 rounded-lg border border-zinc-700 px-3 text-[11px] font-black text-zinc-300 transition-all duration-200 hover:border-zinc-500 hover:text-white active:scale-95"
                >
                  선택 해제
                </button>
              ) : null}
              <Button
                size="sm"
                disabled={selectedPendingProductIds.size === 0}
                isLoading={isPublishingProducts}
                onClick={() => void handlePublishPendingProducts()}
              >
                지금 즉시 올리기
              </Button>
            </div>
          </div>

          {publishFeedback ? (
            <p
              role={publishFeedback.tone === "error" ? "alert" : "status"}
              className={`mt-3 rounded-2xl border px-4 py-3 text-sm font-bold leading-6 ${
                publishFeedback.tone === "success"
                  ? "border-[var(--success-text)]/25 bg-[var(--success-surface)] text-[var(--success-text)]"
                  : publishFeedback.tone === "partial"
                    ? "border-[var(--warning-text)]/25 bg-[var(--warning-surface)] text-[var(--warning-text)]"
                    : "border-[var(--danger-text)]/25 bg-[var(--danger-surface)] text-[var(--danger-text)]"
              }`}
            >
              {publishFeedback.message}
            </p>
          ) : null}

          {productError ? (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)] sm:flex-row sm:items-center sm:justify-between"
            >
              <span>{productError}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void loadProducts()}
              >
                다시 시도
              </Button>
            </div>
          ) : null}

          {productLoadStatus === "loading" && products.length === 0 ? (
            <PanelSkeleton rows={5} />
          ) : pagedProducts.length === 0 ? (
            <EmptyPanel
              title="조건에 맞는 상품이 없습니다"
              description="검색어나 공개 상태를 바꾸면 다른 상품을 확인할 수 있습니다."
            />
          ) : (
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] shadow-sm">
              <div className="hidden grid-cols-[20px_48px_minmax(180px,1fr)_140px_110px_112px] items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)]/70 px-3 py-2 font-mono text-[9px] font-black uppercase tabular-nums tracking-[0.12em] text-[var(--text-muted)] xl:grid">
                <span>선택</span>
                <span>사진</span>
                <span>상품 / Lot</span>
                <span>현재가</span>
                <span>상태</span>
                <span className="text-right">작업</span>
              </div>
            <ul className="divide-y divide-[var(--border)]">
              {pagedProducts.map((product) => (
                <li
                  key={product.id}
                  className="grid grid-cols-[20px_48px_minmax(0,1fr)] items-center gap-3 p-3 transition-all duration-200 ease-out hover:bg-[var(--surface-muted)]/55 xl:grid-cols-[20px_48px_minmax(180px,1fr)_140px_110px_112px]"
                >
                  {product.status === "pending" ? (
                    <label className="grid size-5 cursor-pointer place-items-center">
                      <input
                        type="checkbox"
                        checked={selectedPendingProductIds.has(product.id)}
                        onChange={() =>
                          togglePendingProductSelection(product.id)
                        }
                        disabled={isPublishingProducts}
                        aria-label={`${product.title} 즉시 공개 선택`}
                        className="size-4 rounded border-[var(--border-strong)] accent-[var(--accent)]"
                      />
                    </label>
                  ) : <span aria-hidden="true" />}
                  {product.thumbnailUrls[0] || product.imageUrls[0] ? (
                    <img
                      src={product.thumbnailUrls[0] || product.imageUrls[0]}
                      alt=""
                      className="size-12 rounded-lg border border-[var(--border)] object-cover"
                    />
                  ) : (
                    <div className="grid size-12 place-items-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-muted)] text-[9px] font-black text-[var(--text-muted)]">
                      NO IMG
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[9px] font-black uppercase tabular-nums tracking-[0.12em] text-[var(--text-muted)]" title={product.id}>
                      LOT · {product.id.slice(0, 8)}
                    </p>
                    <h3 className="mt-0.5 truncate text-sm font-black text-[var(--text-strong)]">
                      {product.title}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-[var(--text-muted)]">
                      {product.description}
                    </p>
                  </div>

                  <div className="col-start-2 min-w-0 xl:col-start-auto">
                    <p className="font-mono text-sm font-black tabular-nums tracking-tight text-[var(--text-strong)]">
                      {formatKRW(product.currentPrice)}
                    </p>
                    <p className="mt-0.5 font-mono text-[9px] font-bold tabular-nums text-[var(--text-muted)]">
                      입찰 {product.participantCount}명 · {formatDateTime(product.publish_at)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-black ${productStatusClasses[product.status]}`}>
                      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                      {productStatusLabel[product.status]}
                    </span>
                    {product.bidLockedAt ? (
                      <span className="rounded-full border border-[var(--danger-text)]/25 bg-[var(--danger-surface)] px-2 py-1 text-[9px] font-black text-[var(--danger-text)]">
                        첫 입찰 확정
                      </span>
                    ) : null}
                  </div>

                  <div className="col-span-2 col-start-2 flex shrink-0 gap-1.5 xl:col-span-1 xl:col-start-auto">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-8 flex-1 px-2 active:scale-95"
                      onClick={() => setEditingProduct(product)}
                    >
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      className="min-h-8 flex-1 px-2 active:scale-95"
                      onClick={() => {
                        setDeleteError("");
                        setDeletingProduct(product);
                      }}
                    >
                      삭제
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            </div>
          )}

          <Pagination
            currentPage={safeProductPage}
            totalPages={productTotalPages}
            onPageChange={setProductPage}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="operations-registration"
          active={activeSection === "operations-registration"}
          visited={visitedSections.has("operations-registration")}
          eyebrow="REGISTRATION"
          title="상품 등록"
          summary="일괄 등록을 기본으로 사용하며, 예외 상품은 한 건씩 등록합니다. 일괄 상품은 공개 대기열로 이동합니다."
          defaultOpen
          className="order-1"
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <article className="group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-5 text-white shadow-sm transition-all duration-200 ease-out hover:scale-[1.01] hover:border-zinc-700 hover:shadow-xl active:scale-[0.995] sm:p-6">
              <span className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-white/[0.04] blur-2xl" aria-hidden="true" />
              <p className="font-mono text-[10px] font-black uppercase tabular-nums tracking-[0.16em] text-zinc-500">
                BULK IMPORT
              </p>
              <h3 className="mt-2 text-lg font-black tracking-[-0.02em] text-white">
                상품 일괄 등록 · 기본
              </h3>
              <p className="mt-2 max-w-xl text-xs font-semibold leading-5 text-zinc-400">
                정해진 양식을 내려받는 단계 없이 Excel의 상품·이미지명 열을
                자동으로 찾아 사진 폴더와 연결하고, 등록 전 오류를 검토합니다.
              </p>
              <Button className="mt-6 active:scale-95" onClick={onOpenBulkImport}>
                일괄 등록 열기
              </Button>
            </article>
            <article className="group relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/80 p-5 text-white shadow-sm transition-all duration-200 ease-out hover:scale-[1.01] hover:border-zinc-700 hover:shadow-xl active:scale-[0.995] sm:p-6">
              <span className="pointer-events-none absolute -bottom-10 -right-10 size-32 rounded-full bg-white/[0.04] blur-2xl" aria-hidden="true" />
              <p className="font-mono text-[10px] font-black uppercase tabular-nums tracking-[0.16em] text-zinc-500">
                SINGLE PRODUCT
              </p>
              <h3 className="mt-2 text-lg font-black tracking-[-0.02em] text-white">
                새 경매글 작성
              </h3>
              <p className="mt-2 max-w-xl text-xs font-semibold leading-5 text-zinc-400">
                예외 상품은 설명과 사진을 확인하며 한 건씩 등록하고 공개 시각을
                선택합니다.
              </p>
              <Button
                className="mt-6 active:scale-95"
                variant="secondary"
                onClick={onCreateProduct}
              >
                상품 1건 등록
              </Button>
            </article>
          </div>
        </CollapsibleSection>
        </div>
      </div>

      <Modal
        open={Boolean(editingMember)}
        onClose={
          mutatingMemberId ? () => undefined : () => setEditingMember(null)
        }
        closeOnBackdrop={!mutatingMemberId}
        title="회원 정보 수정"
        description="배송 연락처를 수정합니다. 닉네임은 회원 요청 승인 절차로만 변경됩니다."
        size="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <label className="block text-sm font-black text-[var(--text-strong)]">
            연락처
            <input
              value={editPhone}
              onChange={(event) => setEditPhone(event.target.value)}
              maxLength={30}
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-4 py-3 font-semibold text-[var(--text-strong)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              placeholder="미등록 가능"
            />
          </label>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
            >
              {memberActionError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={Boolean(mutatingMemberId)}
              onClick={() => setEditingMember(null)}
            >
              취소
            </Button>
            <Button
              isLoading={mutatingMemberId === editingMember?.id}
              onClick={() => void saveMemberEdit()}
            >
              저장
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(warningMember)}
        onClose={
          mutatingMemberId ? () => undefined : () => setWarningMember(null)
        }
        closeOnBackdrop={!mutatingMemberId}
        title="회원 경고 등록"
        description="경고 3회마다 입찰 제재가 적용되고 해당 회원의 진행 중 입찰이 취소됩니다."
        size="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <label className="block text-sm font-black text-[var(--text-strong)]">
            경고 종류
            <select
              value={warningCategory}
              onChange={(event) =>
                setWarningCategory(
                  event.target.value as "general" | "late_payment",
                )
              }
              className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-4 py-3 font-semibold text-[var(--text-strong)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
            >
              <option value="general">일반 운영 경고</option>
              <option value="late_payment">결제 지연 경고</option>
            </select>
          </label>
          {warningMember?.paymentDeadlineExempt &&
          warningCategory === "late_payment" ? (
            <p className="rounded-xl bg-[var(--info-surface)] px-4 py-3 text-sm font-bold leading-6 text-[var(--info-text)]">
              밴드 기존 회원은 결제 기한과 결제 지연 경고·제재가 면제되어
              기록되지 않습니다.
            </p>
          ) : null}
          <label className="block text-sm font-black text-[var(--text-strong)]">
            사유
            <textarea
              value={warningReason}
              onChange={(event) => setWarningReason(event.target.value)}
              maxLength={500}
              rows={4}
              className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--input-surface)] px-4 py-3 font-semibold text-[var(--text-strong)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--accent-surface)]"
              placeholder="경고 사유를 구체적으로 입력해 주세요."
            />
          </label>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
            >
              {memberActionError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={Boolean(mutatingMemberId)}
              onClick={() => setWarningMember(null)}
            >
              취소
            </Button>
            <Button
              variant="danger"
              disabled={!warningReason.trim()}
              isLoading={mutatingMemberId === warningMember?.id}
              onClick={() => void submitWarning()}
            >
              경고 등록
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(deletingMember)}
        onClose={
          mutatingMemberId ? () => undefined : () => setDeletingMember(null)
        }
        closeOnBackdrop={!mutatingMemberId}
        title="회원 계정 삭제"
        description="삭제 후에는 로그인과 회원 정보 복구가 어렵습니다."
        size="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-sm font-bold leading-6 text-[var(--text-muted)]">
            <strong>{deletingMember?.displayName || "선택한 회원"}</strong>{" "}
            계정을 삭제할까요? 배송 기록은 개인정보를 제거한 업무 기록으로만
            보존됩니다.
          </p>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
            >
              {memberActionError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={Boolean(mutatingMemberId)}
              onClick={() => setDeletingMember(null)}
            >
              취소
            </Button>
            <Button
              variant="danger"
              isLoading={mutatingMemberId === deletingMember?.id}
              onClick={() => void confirmMemberDelete()}
            >
              회원 삭제
            </Button>
          </div>
        </div>
      </Modal>

      {editingProduct ? (
        <Suspense fallback={null}>
          <ProductEditModal
            product={editingProduct}
            open
            onClose={() => setEditingProduct(null)}
            onSave={handleProductSave}
          />
        </Suspense>
      ) : null}

      <Modal
        open={Boolean(deletingProduct)}
        onClose={
          isDeletingProduct ? () => undefined : () => setDeletingProduct(null)
        }
        closeOnBackdrop={!isDeletingProduct}
        title="경매 상품 삭제"
        description="삭제한 상품은 피드와 운영 센터에서 사라집니다."
        size="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <p className="text-sm font-bold leading-6 text-[var(--text-muted)]">
            <strong className="text-[var(--text-strong)]">{deletingProduct?.title}</strong>
            을(를) 정말 삭제할까요? 입찰 기록이 있는 상품은 서버 정책에 따라
            삭제가 거부될 수 있습니다.
          </p>
          {deleteError ? (
            <p
              role="alert"
              className="rounded-xl bg-[var(--danger-surface)] px-4 py-3 text-sm font-bold text-[var(--danger-text)]"
            >
              {deleteError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setDeletingProduct(null)}
              disabled={isDeletingProduct}
            >
              취소
            </Button>
            <Button
              variant="danger"
              isLoading={isDeletingProduct}
              onClick={() => void handleProductDelete()}
            >
              {isDeletingProduct ? "삭제 중..." : "상품 삭제"}
            </Button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
