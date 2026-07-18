"use client";

/* eslint-disable @next/next/no-img-element -- Supabase Storage 원격 상품 이미지를 표시합니다. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { RevenuePanel } from "./RevenuePanel";
import { ShippingWorkPanel } from "./ShippingWorkPanel";
import { ProductEditModal, type ProductEditValues } from "./ProductEditModal";

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

const productStatusLabel: Record<ManagedProduct["status"], string> = {
  pending: "공개 대기",
  active: "진행 중",
  closed: "마감",
};

const productStatusClasses: Record<ManagedProduct["status"], string> = {
  pending: "border-[#ead5a9] bg-[#fff7df] text-[#82673a]",
  active: "border-[#b9d9c8] bg-[#e5f4eb] text-[#35684f]",
  closed: "border-[#d8d0c9] bg-[#eee9e4] text-[#71675f]",
};

const memberRoleLabel: Record<ManagedAccessRole, string> = {
  operator: "운영자",
  employee: "직원",
  band_member: "밴드 기존 회원",
  member: "일반 회원",
};

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
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#d8c9bc] bg-[#f4e9df] text-sm font-black text-[#765e50]"
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
      className="mt-5 flex items-center justify-center gap-3"
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        이전
      </Button>
      <span className="min-w-20 text-center text-sm font-black text-[#6f5d51]">
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

export function AdminPage({
  role,
  onCreateProduct,
  onOpenBulkImport,
  onProductsChanged,
  onNotify,
}: AdminPageProps) {
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
    <main className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
      <header className="mb-7 flex flex-col gap-5 sm:mb-9 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-black tracking-[0.16em] text-[#688493]">
            OPERATIONS CENTER
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[#493b31] sm:text-4xl">
            운영자 페이지
          </h1>
          <p className="mt-3 max-w-3xl text-[17px] font-bold leading-8 text-[#796b60]">
            회원과 경매 상품을 실제 서버 데이터로 조회하고, 필요한 업무만 펼쳐서
            처리합니다.
          </p>
        </div>
        <span className="w-fit rounded-full border-2 border-[#d6e2e5] bg-[#edf7f9] px-4 py-2 text-sm font-black text-[#4e737c] shadow-sm">
          운영 센터 · 운영자
        </span>
      </header>

      <div className="flex flex-col gap-4">
        <CollapsibleSection
          eyebrow="OVERVIEW"
          title="운영 현황"
          summary="회원과 상품의 현재 상태를 서버 기준으로 빠르게 확인합니다."
          className="order-4"
        >
          <div
            aria-label="운영 현황 요약"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          >
            <article className="rounded-[1.4rem] border border-[#dfd3c7] bg-white p-5">
              <p className="text-sm font-black text-[#8c7b6e]">전체 회원</p>
              <p className="mt-2 text-3xl font-black text-[#493b31]">
                {memberLoadStatus === "success" ? directoryMembers.length : "—"}
                <span className="ml-1 text-sm">명</span>
              </p>
              <p className="mt-2 text-xs font-bold text-[#8c7b6e]">
                {memberLoadStatus === "success"
                  ? `활성 ${activeMemberCount} · 정지 ${suspendedMemberCount}`
                  : "회원 데이터를 확인 중"}
              </p>
            </article>
            <article className="rounded-[1.4rem] border border-[#cbdde5] bg-[#edf7fa] p-5">
              <p className="text-sm font-black text-[#66808e]">진행 중 경매</p>
              <p className="mt-2 text-3xl font-black text-[#3e5b69]">
                {productLoadStatus === "success" ? activeProductCount : "—"}
                <span className="ml-1 text-sm">개</span>
              </p>
              <p className="mt-2 text-xs font-bold text-[#66808e]">
                공개 피드에 노출 중인 상품
              </p>
            </article>
            <article className="rounded-[1.4rem] border border-[#ead5a9] bg-[#fff7df] p-5">
              <p className="text-sm font-black text-[#82673a]">공개 대기</p>
              <p className="mt-2 text-3xl font-black text-[#73572d]">
                {productLoadStatus === "success" ? pendingProductCount : "—"}
                <span className="ml-1 text-sm">개</span>
              </p>
              <p className="mt-2 text-xs font-bold text-[#82673a]">
                예약 공개를 기다리는 상품
              </p>
            </article>
            <article className="rounded-[1.4rem] border border-[#e7c9be] bg-[#fff0ea] p-5">
              <p className="text-sm font-black text-[#966154]">운영 권한</p>
              <p className="mt-2 text-xl font-black text-[#7c473c]">
                회원·상품 관리
              </p>
              <p className="mt-2 text-xs font-bold leading-5 text-[#966154]">
                {hasOwnerAccess
                  ? "운영자 지정까지 포함한 전체 운영 권한"
                  : "회원 상태·등급·배송 이용권 관리"}
              </p>
            </article>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          eyebrow="REVENUE"
          title="매출 현황"
          summary="실제 입금이 확인된 하루 매출만 저장하고 일·주·월·연 단위로 합산합니다."
          className="order-5"
        >
          <RevenuePanel />
        </CollapsibleSection>

        <CollapsibleSection
          eyebrow="SHIPPING"
          title="배송 대기 업무"
          summary="회원이 접수한 상품의 배송지와 운송장 처리 상태를 확인합니다."
          className="order-3"
        >
          <ShippingWorkPanel />
        </CollapsibleSection>

        <CollapsibleSection
          eyebrow="MEMBERS"
          title="회원 관리"
          summary="전체 회원의 계정 상태, 배송 이용권, 상담·입찰 현황을 확인합니다."
          className="order-6"
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
          <p className="mb-4 rounded-2xl border border-[#d5e1e4] bg-[#edf7f9] px-4 py-3 text-sm font-bold leading-6 text-[#4f7179]">
            {hasOwnerAccess
              ? "회원 정보·상태·등급을 관리하고 필요할 때 운영자 권한을 지정할 수 있습니다."
              : "회원 정보·상태·등급과 배송 이용권을 이 화면에서 관리할 수 있습니다."}
          </p>

          <section
            className="mb-5 rounded-[1.4rem] border border-[#e4d3c5] bg-[#fff7ef] p-4 sm:p-5"
            aria-labelledby="nickname-review-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black tracking-[0.14em] text-[#a86655]">
                  NICKNAME REVIEW
                </p>
                <h3
                  id="nickname-review-title"
                  className="mt-1 text-lg font-black text-[#513f35]"
                >
                  닉네임 변경 승인
                </h3>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-sm font-black text-[#a86655]">
                대기 {nicknameRequests.length}건
              </span>
            </div>
            {nicknameRequestError ? (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-[#fff0ea] px-3 py-2 text-sm font-bold text-[#a84c3f]"
              >
                {nicknameRequestError}
              </p>
            ) : null}
            {nicknameRequests.length === 0 ? (
              <p className="mt-3 text-sm font-bold text-[#806f64]">
                현재 승인 대기 요청이 없습니다.
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {nicknameRequests.map((request) => {
                  const isReviewing = reviewingNicknameRequestId === request.id;
                  return (
                    <li
                      key={request.id}
                      className="flex flex-col gap-3 rounded-2xl border border-[#e7d9ce] bg-white p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-black text-[#4c3e36]">
                          {request.currentNickname}{" "}
                          <span aria-hidden="true">→</span>{" "}
                          <strong className="text-[#b25f4f]">
                            {request.requestedNickname}
                          </strong>
                        </p>
                        <p className="mt-1 text-xs font-bold text-[#8a796e]">
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
            <label className="text-sm font-black text-[#594a40]">
              회원 검색
              <input
                type="search"
                value={memberQuery}
                onChange={(event) => {
                  setMemberQuery(event.target.value);
                  setMemberPage(1);
                }}
                placeholder="닉네임, 이름, 출생연도, 연락처 또는 회원 ID"
                className="mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
              />
            </label>
            <label className="text-sm font-black text-[#594a40]">
              계정 상태
              <select
                value={memberStatusFilter}
                onChange={(event) => {
                  setMemberStatusFilter(
                    event.target.value as MemberStatusFilter,
                  );
                  setMemberPage(1);
                }}
                className="mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
              >
                <option value="all">전체 상태</option>
                <option value="active">활성</option>
                <option value="suspended">이용 정지</option>
              </select>
            </label>
            <label className="text-sm font-black text-[#594a40]">
              성별 기준
              <select
                value={memberGenderFilter}
                onChange={(event) => {
                  setMemberGenderFilter(
                    event.target.value as MemberGenderFilter,
                  );
                  setMemberPage(1);
                }}
                className="mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
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
              className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#efc8bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f] sm:flex-row sm:items-center sm:justify-between"
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
            <p className="mt-5 rounded-2xl border border-[#e5d9ce] bg-white px-4 py-8 text-center text-sm font-bold text-[#7b6c61]">
              회원 목록을 불러오는 중입니다...
            </p>
          ) : pagedMembers.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-[#ddcfc2] bg-white/70 px-4 py-8 text-center text-sm font-bold text-[#7b6c61]">
              조건에 맞는 회원이 없습니다.
            </p>
          ) : (
            <ul className="mt-5 grid gap-3 xl:grid-cols-2">
              {pagedMembers.map((member) => {
                const isMutating = mutatingMemberId === member.id;
                return (
                  <li
                    key={member.id}
                    className="rounded-[1.4rem] border border-[#e4d8cd] bg-white p-4 shadow-[0_8px_22px_rgba(89,65,49,0.05)] sm:p-5"
                  >
                    <div className="flex items-start gap-3">
                      <MemberInitial member={member} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-black text-[#493b31]">
                            {member.displayName || "이름 미설정"}
                          </h3>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${
                              member.accountStatus === "active"
                                ? "border-[#b9d9c8] bg-[#e5f4eb] text-[#35684f]"
                                : "border-[#e7bdb4] bg-[#fff0ea] text-[#9d493d]"
                            }`}
                          >
                            {member.accountStatus === "active"
                              ? "활성"
                              : "이용 정지"}
                          </span>
                          <span className="rounded-full border border-[#d6d2e8] bg-[#f3f1fb] px-2.5 py-1 text-[11px] font-black text-[#635d82]">
                            {memberRoleLabel[member.accessRole]}
                          </span>
                          {member.supportStatus ? (
                            <span className="rounded-full border border-[#cbdde5] bg-[#edf7fa] px-2.5 py-1 text-[11px] font-black text-[#4f717b]">
                              상담{" "}
                              {member.supportStatus === "open"
                                ? "진행"
                                : "종료"}
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${member.kakaoProfileComplete ? "border-[#c7dbca] bg-[#edf7ef] text-[#467052]" : "border-[#ead5ae] bg-[#fff8e6] text-[#876a37]"}`}
                          >
                            {member.kakaoProfileComplete
                              ? "카카오 정보 확인"
                              : "카카오 정보 대기"}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-[#77685d]">
                          실명 {member.legalName || "확인 대기"} · 성별{" "}
                          {member.gender === "female"
                            ? "여성"
                            : member.gender === "male"
                              ? "남성"
                              : "확인 대기"}{" "}
                          · 출생연도{" "}
                          {member.birthYear
                            ? `${member.birthYear}년`
                            : "확인 대기"}
                        </p>
                        <p className="mt-1 truncate text-xs font-semibold text-[#9a8a7e]">
                          배송 연락처 {member.phone || "미등록"} · ID{" "}
                          {member.id}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          배송 이용권
                        </dt>
                        <dd className="mt-1 text-sm font-black text-[#4e4037]">
                          {member.shippingCreditCount}개
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          배송지
                        </dt>
                        <dd className="mt-1 text-sm font-black text-[#4e4037]">
                          {member.addressCount}곳
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          입찰
                        </dt>
                        <dd className="mt-1 text-sm font-black text-[#4e4037]">
                          {member.bidCount}회
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          최근 접속
                        </dt>
                        <dd
                          className="mt-1 truncate text-[11px] font-black text-[#4e4037]"
                          title={formatDateTime(member.lastSeenAt)}
                        >
                          {formatDateTime(member.lastSeenAt)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          경고 / 제재
                        </dt>
                        <dd className="mt-1 text-sm font-black text-[#4e4037]">
                          {member.warningCount} / {member.sanctionCount}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-[#faf5ef] px-3 py-2">
                        <dt className="text-[11px] font-black text-[#8b7a6d]">
                          입찰 제한
                        </dt>
                        <dd
                          className="mt-1 truncate text-[11px] font-black text-[#4e4037]"
                          title={formatDateTime(member.bidBlockedUntil)}
                        >
                          {member.bidBlockedUntil
                            ? formatDateTime(member.bidBlockedUntil)
                            : "없음"}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 space-y-3 border-t border-[#eee4db] pt-4">
                      <div className="grid gap-2 sm:grid-cols-[170px_auto_1fr] sm:items-center">
                        <label className="text-xs font-black text-[#77675c]">
                          회원 권한
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
                            className="mt-1 w-full rounded-xl border border-[#ddcfc3] bg-white px-3 py-2 text-sm font-bold"
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
                          <div className="flex items-center gap-2 sm:pt-5">
                            <span className="text-xs font-black text-[#77675c]">
                              배송 이용권
                            </span>
                            <button
                              type="button"
                              aria-label={`${member.displayName || "회원"} 배송 이용권 1개 차감`}
                              disabled={
                                isMutating || member.shippingCreditCount <= 0
                              }
                              onClick={() =>
                                void handleShippingCreditChange(member, -1)
                              }
                              className="grid h-10 w-10 place-items-center rounded-xl border border-[#ddcfc3] bg-white text-lg font-black text-[#775f50] disabled:opacity-40"
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
                              className="grid h-10 w-10 place-items-center rounded-xl border border-[#c9dce1] bg-[#edf7fa] text-lg font-black text-[#496c76] disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {member.accessRole !== "operator" ? (
                        <div className="flex flex-wrap gap-2">
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <Pagination
            currentPage={safeMemberPage}
            totalPages={memberTotalPages}
            onPageChange={setMemberPage}
          />
        </CollapsibleSection>

        <CollapsibleSection
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
            <label className="text-sm font-black text-[#594a40]">
              상품 검색
              <input
                type="search"
                value={productQuery}
                onChange={(event) => {
                  setProductQuery(event.target.value);
                  setProductPage(1);
                }}
                placeholder="상품명, 설명 또는 상품 ID"
                className="mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
              />
            </label>
            <label className="text-sm font-black text-[#594a40]">
              공개 상태
              <select
                value={productStatusFilter}
                onChange={(event) => {
                  setProductStatusFilter(
                    event.target.value as ProductStatusFilter,
                  );
                  setProductPage(1);
                }}
                className="mt-2 w-full rounded-2xl border border-[#decdbf] bg-white px-4 py-3 text-sm font-semibold text-[#463a34] outline-none transition focus:border-[#ec7866] focus:ring-4 focus:ring-[#ec7866]/10"
              >
                <option value="all">전체 상태</option>
                <option value="pending">공개 대기</option>
                <option value="active">진행 중</option>
                <option value="closed">마감</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#d8ded6] bg-[#f6f8f3] p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-center gap-3 text-sm font-black text-[#554b43]">
              <input
                ref={selectAllPendingRef}
                type="checkbox"
                checked={areAllPendingProductsSelected}
                onChange={toggleAllPendingProducts}
                disabled={
                  selectablePendingProductIds.length === 0 ||
                  isPublishingProducts
                }
                className="h-5 w-5 rounded border-[#cbbdaf] accent-[#d96756]"
              />
              검색 결과의 공개 대기 상품 전체 선택
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-black text-[#77695f]">
                {selectedPendingProductIds.size.toLocaleString("ko-KR")}개 선택
              </span>
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
                  ? "border-[#b9d9c8] bg-[#e8f5ed] text-[#35684f]"
                  : publishFeedback.tone === "partial"
                    ? "border-[#ead5a9] bg-[#fff7df] text-[#82673a]"
                    : "border-[#efc8bb] bg-[#fff0ea] text-[#a84c3f]"
              }`}
            >
              {publishFeedback.message}
            </p>
          ) : null}

          {productError ? (
            <div
              role="alert"
              className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#efc8bb] bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f] sm:flex-row sm:items-center sm:justify-between"
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
            <p className="mt-5 rounded-2xl border border-[#e5d9ce] bg-white px-4 py-8 text-center text-sm font-bold text-[#7b6c61]">
              상품 목록을 불러오는 중입니다...
            </p>
          ) : pagedProducts.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-[#ddcfc2] bg-white/70 px-4 py-8 text-center text-sm font-bold text-[#7b6c61]">
              조건에 맞는 상품이 없습니다.
            </p>
          ) : (
            <ul className="mt-5 space-y-3">
              {pagedProducts.map((product) => (
                <li
                  key={product.id}
                  className="flex flex-col gap-4 rounded-[1.4rem] border border-[#e4d8cd] bg-white p-4 shadow-[0_8px_22px_rgba(89,65,49,0.05)] sm:flex-row sm:items-center"
                >
                  {product.status === "pending" ? (
                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-black text-[#66584f] sm:self-start sm:pt-1">
                      <input
                        type="checkbox"
                        checked={selectedPendingProductIds.has(product.id)}
                        onChange={() =>
                          togglePendingProductSelection(product.id)
                        }
                        disabled={isPublishingProducts}
                        aria-label={`${product.title} 즉시 공개 선택`}
                        className="h-5 w-5 rounded border-[#cbbdaf] accent-[#d96756]"
                      />
                      <span className="sm:hidden">선택</span>
                    </label>
                  ) : null}
                  {product.thumbnailUrls[0] || product.imageUrls[0] ? (
                    <img
                      src={product.thumbnailUrls[0] || product.imageUrls[0]}
                      alt=""
                      className="h-28 w-full rounded-2xl border border-[#e8ddd3] object-cover sm:h-24 sm:w-24 sm:shrink-0"
                    />
                  ) : (
                    <div className="grid h-28 w-full place-items-center rounded-2xl border border-dashed border-[#ddcfc2] bg-[#faf5ef] text-xs font-black text-[#97877b] sm:h-24 sm:w-24 sm:shrink-0">
                      사진 없음
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${productStatusClasses[product.status]}`}
                      >
                        {productStatusLabel[product.status]}
                      </span>
                      {product.bidLockedAt ? (
                        <span className="rounded-full border border-[#e7bdb4] bg-[#fff0ea] px-2.5 py-1 text-[11px] font-black text-[#9d493d]">
                          첫 입찰 확정
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 truncate text-lg font-black text-[#493b31]">
                      {product.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold leading-6 text-[#7d6d62]">
                      {product.description}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-[#8b7a6d]">
                      <span>현재가 {formatKRW(product.currentPrice)}</span>
                      <span>입찰 {product.participantCount}명</span>
                      <span>공개 {formatDateTime(product.publish_at)}</span>
                      <span>수정 {formatDateTime(product.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2 sm:flex-col">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setEditingProduct(product)}
                    >
                      수정
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      className="flex-1"
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
          )}

          <Pagination
            currentPage={safeProductPage}
            totalPages={productTotalPages}
            onPageChange={setProductPage}
          />
        </CollapsibleSection>

        <CollapsibleSection
          eyebrow="REGISTRATION"
          title="상품 등록"
          summary="일괄 등록을 기본으로 사용하며, 예외 상품은 한 건씩 등록합니다. 일괄 상품은 공개 대기열로 이동합니다."
          defaultOpen
          className="order-1"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-[1.4rem] border-2 border-[#b9d5db] bg-[#edf7fa] p-5 shadow-sm sm:p-6">
              <p className="text-xs font-black tracking-[0.14em] text-[#577984]">
                BULK IMPORT
              </p>
              <h3 className="mt-2 text-xl font-black text-[#385b65]">
                상품 일괄 등록 · 기본
              </h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#617b83]">
                정해진 양식을 내려받는 단계 없이 Excel의 상품·이미지명 열을
                자동으로 찾아 사진 폴더와 연결하고, 등록 전 오류를 검토합니다.
              </p>
              <Button className="mt-5" onClick={onOpenBulkImport}>
                일괄 등록 열기
              </Button>
            </article>
            <article className="rounded-[1.4rem] border border-[#efd2c8] bg-[#fff2ec] p-5 sm:p-6">
              <p className="text-xs font-black tracking-[0.14em] text-[#a56051]">
                SINGLE PRODUCT
              </p>
              <h3 className="mt-2 text-xl font-black text-[#5c4037]">
                새 경매글 작성
              </h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#83685e]">
                예외 상품은 설명과 사진을 확인하며 한 건씩 등록하고 공개 시각을
                선택합니다.
              </p>
              <Button
                className="mt-5"
                variant="secondary"
                onClick={onCreateProduct}
              >
                상품 1건 등록
              </Button>
            </article>
          </div>
        </CollapsibleSection>
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
          <label className="block text-sm font-black text-[#594a40]">
            연락처
            <input
              value={editPhone}
              onChange={(event) => setEditPhone(event.target.value)}
              maxLength={30}
              className="mt-2 w-full rounded-xl border border-[#decdbf] bg-white px-4 py-3 font-semibold"
              placeholder="미등록 가능"
            />
          </label>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f]"
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
          <label className="block text-sm font-black text-[#594a40]">
            경고 종류
            <select
              value={warningCategory}
              onChange={(event) =>
                setWarningCategory(
                  event.target.value as "general" | "late_payment",
                )
              }
              className="mt-2 w-full rounded-xl border border-[#decdbf] bg-white px-4 py-3 font-semibold"
            >
              <option value="general">일반 운영 경고</option>
              <option value="late_payment">결제 지연 경고</option>
            </select>
          </label>
          {warningMember?.paymentDeadlineExempt &&
          warningCategory === "late_payment" ? (
            <p className="rounded-xl bg-[#edf7fa] px-4 py-3 text-sm font-bold leading-6 text-[#4f7179]">
              밴드 기존 회원은 결제 기한과 결제 지연 경고·제재가 면제되어
              기록되지 않습니다.
            </p>
          ) : null}
          <label className="block text-sm font-black text-[#594a40]">
            사유
            <textarea
              value={warningReason}
              onChange={(event) => setWarningReason(event.target.value)}
              maxLength={500}
              rows={4}
              className="mt-2 w-full resize-none rounded-xl border border-[#decdbf] bg-white px-4 py-3 font-semibold"
              placeholder="경고 사유를 구체적으로 입력해 주세요."
            />
          </label>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f]"
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
          <p className="text-sm font-bold leading-6 text-[#66564c]">
            <strong>{deletingMember?.displayName || "선택한 회원"}</strong>{" "}
            계정을 삭제할까요? 배송 기록은 개인정보를 제거한 업무 기록으로만
            보존됩니다.
          </p>
          {memberActionError ? (
            <p
              role="alert"
              className="rounded-xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#a84c3f]"
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

      <ProductEditModal
        product={editingProduct}
        open={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        onSave={handleProductSave}
      />

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
          <p className="text-sm font-bold leading-6 text-[#66564c]">
            <strong className="text-[#493b31]">{deletingProduct?.title}</strong>
            을(를) 정말 삭제할까요? 입찰 기록이 있는 상품은 서버 정책에 따라
            삭제가 거부될 수 있습니다.
          </p>
          {deleteError ? (
            <p
              role="alert"
              className="rounded-2xl bg-[#fff0ea] px-4 py-3 text-sm font-bold text-[#b14c3f]"
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
