import type {
  AdminSaleRecord,
  AdminShipmentBatch,
  BuyerInfo,
  ShippingAddress,
} from "@/src/types/auction";

import type {
  AdminSettlementGroup,
  RecentClosingDay,
  SettlementStatusTone,
} from "./adminTypes";

const KST_TIME_ZONE = "Asia/Seoul";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function getDateParts(date: Date, timeZone = KST_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    weekday: part("weekday"),
  };
}

export function getKoreanDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const { year, month, day } = getDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getSettlementStatus(sales: readonly AdminSaleRecord[]): {
  label: string;
  tone: SettlementStatusTone;
} {
  if (sales.some((sale) => sale.paymentStatus === "pending")) {
    return { label: "입금 대기", tone: "warning" };
  }

  if (
    sales.every(
      (sale) => sale.stage === "shipped" || sale.shippingStatus === "shipped",
    )
  ) {
    return { label: "배송 중 / 발송 완료", tone: "mint" };
  }

  if (
    sales.some(
      (sale) =>
        sale.stage === "shipping-requested" || sale.shippingStatus === "ready",
    )
  ) {
    return { label: "포장 대기", tone: "blue" };
  }

  return { label: "결제 완료 / 보관 중", tone: "slate" };
}

function groupSalesByBuyer(
  sales: readonly AdminSaleRecord[],
): AdminSettlementGroup[] {
  const grouped = new Map<string, AdminSaleRecord[]>();

  sales.forEach((sale) => {
    const current = grouped.get(sale.buyer.userId) ?? [];
    current.push(sale);
    grouped.set(sale.buyer.userId, current);
  });

  return Array.from(grouped.entries()).map(([userId, buyerSales]) => {
    const status = getSettlementStatus(buyerSales);
    return {
      id: `${getKoreanDateKey(buyerSales[0].soldAt)}-${userId}`,
      buyer: buyerSales[0].buyer,
      sales: buyerSales,
      totalWinningBid: buyerSales.reduce(
        (sum, sale) => sum + sale.winningBid,
        0,
      ),
      statusLabel: status.label,
      statusTone: status.tone,
    };
  });
}

/** 오늘(KST)을 포함해 판매가 없는 날까지 정확히 7일을 만듭니다. */
export function buildRecentSevenClosingDays(
  sales: readonly AdminSaleRecord[],
  now = new Date(),
): RecentClosingDay[] {
  const today = getDateParts(now);
  const todayUtcAnchor = Date.UTC(today.year, today.month - 1, today.day, 12);

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(todayUtcAnchor - index * DAY_IN_MILLISECONDS);
    const dayParts = getDateParts(day, "UTC");
    const dateKey = `${dayParts.year}-${String(dayParts.month).padStart(2, "0")}-${String(dayParts.day).padStart(2, "0")}`;
    const daySales = sales.filter(
      (sale) => getKoreanDateKey(sale.soldAt) === dateKey,
    );

    return {
      dateKey,
      label: `${dayParts.month}월 ${dayParts.day}일 마감`,
      weekdayLabel: dayParts.weekday,
      isToday: index === 0,
      sales: daySales,
      settlements: groupSalesByBuyer(daySales),
    };
  });
}

function createAddressSnapshot(buyer: BuyerInfo): ShippingAddress {
  return {
    id: `admin-address-${buyer.userId}`,
    label: "최종 배송지",
    recipientName: buyer.name,
    phone: buyer.phone,
    address: buyer.address,
    isDefault: true,
  };
}

/** 기존 판매 데이터만 전달될 때도 관리자 화면을 테스트할 수 있는 호환 어댑터입니다. */
export function buildShipmentBatchesFromSales(
  sales: readonly AdminSaleRecord[],
): AdminShipmentBatch[] {
  const shippableSales = sales.filter(
    (sale) => sale.shippingStatus === "ready" || sale.shippingStatus === "shipped",
  );
  const grouped = new Map<string, AdminSaleRecord[]>();

  shippableSales.forEach((sale) => {
    const status = sale.shippingStatus === "shipped" ? "shipped" : "packing";
    const key = `${status}-${sale.buyer.userId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), sale]);
  });

  return Array.from(grouped.entries()).map(([key, batchSales]) => {
    const first = batchSales[0];
    const status = first.shippingStatus === "shipped" ? "shipped" : "packing";
    return {
      id: `derived-${key}`,
      buyer: first.buyer,
      shippingAddress: createAddressSnapshot(first.buyer),
      requestedAt: first.soldAt,
      scheduledAt: first.soldAt,
      items: batchSales.map((sale) => ({
        id: sale.id,
        auctionId: sale.auctionId,
        title: sale.title,
        description: sale.description ?? sale.title,
        imageUrls:
          sale.imageUrls && sale.imageUrls.length > 0
            ? sale.imageUrls
            : [sale.thumbnailUrl],
        thumbnailUrl: sale.thumbnailUrl,
        winningBid: sale.winningBid,
      })),
      status,
      courier: status === "shipped" ? ("한진택배" as const) : undefined,
      shippedAt: status === "shipped" ? first.soldAt : undefined,
    };
  });
}
