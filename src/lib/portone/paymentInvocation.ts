export type ProductPaymentMethod = "CARD" | "EASY_PAY" | "VIRTUAL_ACCOUNT";

export interface PortOnePreparedPaymentInput {
  storeId: string;
  channelKey: string;
  paymentId: string;
  orderName: string;
  totalAmount: number;
  currency: "KRW";
  customer?: {
    customerId?: string;
    fullName?: string;
    phoneNumber?: string;
    email?: string;
  };
}

export interface PortOneProductPaymentRequest
  extends PortOnePreparedPaymentInput {
  payMethod: ProductPaymentMethod;
  redirectUrl: string;
  noticeUrls?: string[];
  easyPay?: {
    easyPayProvider: "KAKAOPAY";
  };
}

export type PreparedPaymentAction = "open" | "sync_pending" | "sync_terminal";

interface PreparedPaymentState {
  paymentStatus?: "대기중" | "가상계좌발급" | "결제완료";
  portoneStatus?:
    | "READY"
    | "PAY_PENDING"
    | "VIRTUAL_ACCOUNT_ISSUED"
    | "PAID"
    | "FAILED"
    | "PARTIAL_CANCELLED"
    | "CANCELLED"
    | null;
  canRetryPayment?: boolean;
}

export function preparedPaymentAction(
  prepared: PreparedPaymentState,
): PreparedPaymentAction {
  if (prepared.portoneStatus === "PAY_PENDING") return "sync_pending";

  const retryableTerminalState =
    (prepared.portoneStatus === "FAILED" ||
      prepared.portoneStatus === "CANCELLED") &&
    prepared.canRetryPayment === true;

  if (
    prepared.paymentStatus === "결제완료" ||
    prepared.paymentStatus === "가상계좌발급" ||
    prepared.portoneStatus === "PARTIAL_CANCELLED" ||
    ((prepared.portoneStatus === "FAILED" ||
      prepared.portoneStatus === "CANCELLED") &&
      !retryableTerminalState)
  ) {
    return "sync_terminal";
  }

  return "open";
}

export function buildPortOneProductPaymentRequest(input: {
  prepared: PortOnePreparedPaymentInput;
  payMethod: ProductPaymentMethod;
  origin: string;
  webhookUrl?: string;
}): PortOneProductPaymentRequest {
  const redirectUrl = new URL("/payment/complete", input.origin);
  redirectUrl.searchParams.set("paymentId", input.prepared.paymentId);

  return {
    storeId: input.prepared.storeId,
    channelKey: input.prepared.channelKey,
    paymentId: input.prepared.paymentId,
    orderName: input.prepared.orderName,
    totalAmount: input.prepared.totalAmount,
    currency: input.prepared.currency,
    payMethod: input.payMethod,
    customer: input.prepared.customer,
    ...(input.webhookUrl ? { noticeUrls: [input.webhookUrl] } : {}),
    redirectUrl: redirectUrl.toString(),
    ...(input.payMethod === "EASY_PAY"
      ? { easyPay: { easyPayProvider: "KAKAOPAY" as const } }
      : {}),
  };
}

export async function invokePortOneProductPayment<T>(
  input: Parameters<typeof buildPortOneProductPaymentRequest>[0],
  requestPayment: (request: PortOneProductPaymentRequest) => Promise<T>,
): Promise<T> {
  return requestPayment(buildPortOneProductPaymentRequest(input));
}
