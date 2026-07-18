/** 서버 역할 RPC 결과를 기존 화면 컴포넌트에 전달할 때 사용하는 호환 역할입니다. */
export type Role = "user" | "operator" | "admin";

/** 공개 화면에 표시할 수 있는 등급입니다. 내부 소유자 등급은 포함하지 않습니다. */
export type PublicRoleGrade = 1 | 2 | 2.5 | 3;

/**
 * 권한 정책에서 사용하는 공개 역할 이름입니다. 기존 `admin` 값은 서버 내부의
 * 소유자 식별자로만 유지하고 공개 역할에 포함하지 않습니다.
 */
export type PublicRoleName = "operator" | "employee" | "band_member" | "member";

export type AuctionStatus = "pending" | "active" | "closed";

export type ISODateString = string;

export type KoreanWeekday = "월" | "화" | "수" | "목" | "금" | "토" | "일";

export type PaymentStatus = "paid" | "pending";

export type ShippingStatus = "preparing" | "ready" | "shipped";

export type WonAuctionStage =
  "payment-pending" | "keep" | "shipping-requested" | "shipped";

export interface ShippingAddress {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  address: string;
  isDefault: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  address: string;
  /** 택배 접수 1건에 사용할 수 있는 선결제 이용권 수 */
  shippingCount: number;
  shippingAddresses: ShippingAddress[];
}

/**
 * 공개 입찰 기록 한 건입니다.
 *
 * 실제 서비스에서는 서버가 생성한 append-only 원장만 반환해야 하며,
 * 클라이언트나 운영 UI에서 기존 기록을 수정할 수 없어야 합니다.
 */
export interface BidHistoryRecord {
  readonly id: string;
  readonly bidAt: ISODateString;
  /** 회원이 설정한 공개 닉네임. 입찰 투명성을 위해 공개 UI에 그대로 표시합니다. */
  readonly bidderName: string;
  readonly amount: number;
  /** 미입금·제재로 효력을 잃어도 투명성을 위해 공개 기록은 보존합니다. */
  readonly outcome?: "active" | "cancelled" | "unpaid_cancelled";
}

export interface AuctionPost {
  id: string;
  title: string;
  description: string;
  category: string;
  createdAt: ISODateString;
  /** 예약 공개 시각. 기존 데이터는 createdAt을 공개 시각으로 사용합니다. */
  publish_at?: ISODateString;
  closesAt: ISODateString;
  status: AuctionStatus;
  participantCount: number;
  startingPrice: number;
  currentPrice: number;
  bidIncrement: number;
  /** 피드와 작은 카드에 사용하는 최대 640x360 파생 이미지 */
  thumbnailUrls: string[];
  /** 사진 확대 화면에 사용하는 최대 1280x720 이미지 */
  imageUrls: string[];
  /** 20:56 이후 무입찰 상품의 첫 입찰이 즉시 확정된 시각 */
  bidLockedAt?: ISODateString;
  /** 즉시 확정된 금액. 회원 UUID는 공개 피드에 노출하지 않습니다. */
  finalBidAmount?: number;
  /** 최초 안티 스나이핑 연장 직전의 서버 마감 시각 */
  antiSnipingBaseClosesAt?: ISODateString;
  /** 마지막으로 서버가 마감을 3분으로 재설정한 시각 */
  antiSnipingExtendedAt?: ISODateString;
  /** 서버에서 확정된 누적 마감 연장 횟수 */
  antiSnipingExtensionCount?: number;
  /** 최신 입찰이 첫 번째인 읽기 전용 공개 기록 */
  readonly bidHistory: readonly BidHistoryRecord[];
}

export interface WonAuction {
  id: string;
  auctionId: string;
  title: string;
  thumbnailUrl: string;
  closedAt: ISODateString;
  winningBid: number;
  /** 패딩 등 부피가 큰 상품은 보관 기한이 7일로 제한됩니다. */
  isBulky: boolean;
  paymentStatus: PaymentStatus;
  stage: WonAuctionStage;
  /** 결제하기를 처음 눌러 계좌 안내를 확인한 시각 */
  paymentStartedAt?: ISODateString;
  /** 낙찰 다음 날 오전 11:59:59로 서버가 확정한 입금 마감 */
  paymentDeadlineAt?: ISODateString;
  paidAt?: ISODateString;
  keepExpiresAt?: ISODateString;
  shippingRequestedAt?: ISODateString;
  shippingScheduledAt?: ISODateString;
  /** 한 번의 합배송 접수로 묶인 상품들이 공유하는 서버 발급 식별자 */
  shipmentBatchId?: string;
  shippingAddress?: ShippingAddress;
  courier?: "한진택배";
  trackingNumber?: string;
  shippedAt?: ISODateString;
  /** 운영 피킹 화면에서 사용하는 낙찰 당시 상품 설명 스냅샷 */
  description?: string;
  /** 운영 피킹 화면에서 사용하는 원본 사진 스냅샷 */
  imageUrls?: readonly string[];
}

export interface BatchPaymentStartPayload {
  readonly auctionIds: readonly string[];
  startedAt: ISODateString;
}

export interface BatchPaymentCompletionPayload {
  readonly auctionIds: readonly string[];
  includeShippingFee: boolean;
  productAmount: number;
  shippingFee: number;
  totalAmount: number;
  completedAt: ISODateString;
}

export interface ShippingCreditCompletionPayload {
  amount: number;
  completedAt: ISODateString;
}

export interface ShippingRequestPayload {
  /** 접수 후 항목이 바뀌지 않도록 읽기 전용 스냅샷으로 전달합니다. */
  readonly itemIds: readonly string[];
  requestedAt: ISODateString;
  scheduledAt: ISODateString;
  /** 접수 이후 주소 변경의 영향을 받지 않는 배송지 스냅샷 */
  shippingAddress: ShippingAddress;
}

export interface ShipmentBatchItem {
  id: string;
  auctionId: string;
  title: string;
  description: string;
  imageUrls: readonly string[];
  thumbnailUrl: string;
  winningBid: number;
}

export type ShipmentBatchStatus = "packing" | "shipped";

/** 운영 물류 화면과 구매자 배송 현황이 공유하는 합배송 요청 스냅샷입니다. */
export interface AdminShipmentBatch {
  id: string;
  buyer: BuyerInfo;
  shippingAddress: ShippingAddress;
  requestedAt: ISODateString;
  scheduledAt: ISODateString;
  items: readonly ShipmentBatchItem[];
  status: ShipmentBatchStatus;
  courier?: "한진택배";
  trackingNumber?: string;
  shippedAt?: ISODateString;
}

export interface ShipmentRegistrationPayload {
  batchId: string;
  trackingNumber: string;
  courier: "한진택배";
  shippedAt: ISODateString;
}

export interface BuyerInfo {
  userId: string;
  name: string;
  phone: string;
  address: string;
}

export interface AdminSaleRecord {
  id: string;
  auctionId: string;
  title: string;
  thumbnailUrl: string;
  soldAt: ISODateString;
  winningBid: number;
  buyer: BuyerInfo;
  paymentStatus: PaymentStatus;
  shippingStatus: ShippingStatus;
  /** 최근 마감 목록의 운영 상태를 서버 스냅샷 그대로 표시합니다. */
  stage?: WonAuctionStage;
  description?: string;
  imageUrls?: readonly string[];
}

export interface PaymentAccount {
  bankName: string;
  accountNumber: string;
  accountHolder: string;
}

export interface CountdownParts {
  totalMilliseconds: number;
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
}

export interface WeekdayGroup<T> {
  weekday: KoreanWeekday;
  items: T[];
}
