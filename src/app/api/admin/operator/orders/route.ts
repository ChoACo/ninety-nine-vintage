import { authenticateStaffRequest, commerceJson } from "@/lib/commerce/server";
import { getCatalogImageUrl } from "@/lib/images";

const HISTORY_PAGE_SIZE = 100;
const LEDGER_DISPLAY_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;

type QueueStatus =
  | "awaiting_transfer"
  | "partially_paid"
  | "confirmed"
  | "cancelled";

interface HistoryCursor {
  activityAt: string;
  transferId: string;
}

interface QueueLedgerEntry {
  id: string;
  entry_type: "receipt" | "reversal";
  amount: number;
  depositor_name: string | null;
  memo: string;
  reversal_of: string | null;
  recorded_by: string;
  created_at: string;
}

interface QueueTransfer {
  id: string;
  order_id: string;
  member_id: string;
  expected_amount: number;
  status: QueueStatus;
  bank_name_snapshot: string;
  account_number_snapshot: string;
  requested_at: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  activityAt: string;
  receivedAmount: number;
  ledgerEntryCount: number;
  ledgerHistoryComplete: boolean;
  remainingAmount: number;
  ledger: QueueLedgerEntry[];
}

interface QueueSnapshot {
  activeOverflow: boolean;
  integrityError: boolean;
  activeCount: number;
  active: QueueTransfer[];
  history: QueueTransfer[];
  historyHasMore: boolean;
  nextHistoryCursor: HistoryCursor | null;
}

interface OrderItem {
  order_id: string;
  product_id: string;
  unit_price: number;
  payment_status: string;
  products: { title: string; image_urls: string[] } | null;
  commerce_orders: {
    member_id: string;
    status: string;
    total: number;
    created_at: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestampSortKey(value) !== null;
}

function timestampSortKey(value: string) {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    0,
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month] ?? 0;
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const microseconds = (match[7]?.slice(1) ?? "").padEnd(6, "0");
  const subMillisecond = BigInt(microseconds.slice(3, 6));
  return BigInt(milliseconds) * BigInt(1000) + subMillisecond;
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function rowsAreStrictlyDescending(
  rows: Array<{ id: string; timestamp: string }>,
) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const previousTime = timestampSortKey(previous.timestamp);
    const currentTime = timestampSortKey(current.timestamp);
    if (previousTime === null || currentTime === null) return false;
    if (previousTime < currentTime) return false;
    if (
      previousTime === currentTime &&
      previous.id.toLowerCase() <= current.id.toLowerCase()
    ) {
      return false;
    }
  }
  return true;
}

function tupleIsStrictlyBefore(
  row: { id: string; timestamp: string },
  cursor: HistoryCursor,
) {
  const rowTime = timestampSortKey(row.timestamp);
  const cursorTime = timestampSortKey(cursor.activityAt);
  if (rowTime === null || cursorTime === null) return false;
  return rowTime < cursorTime || (
    rowTime === cursorTime &&
    row.id.toLowerCase() < cursor.transferId.toLowerCase()
  );
}

const LEDGER_KEYS = [
  "id",
  "entry_type",
  "amount",
  "depositor_name",
  "memo",
  "reversal_of",
  "recorded_by",
  "created_at",
] as const;

function parseLedgerEntry(value: unknown): QueueLedgerEntry | null {
  if (!isRecord(value) || !hasExactlyKeys(value, LEDGER_KEYS)) return null;
  if (
    !isUuid(value.id) ||
    (value.entry_type !== "receipt" && value.entry_type !== "reversal") ||
    !isSafeInteger(value.amount, 1) ||
    typeof value.memo !== "string" ||
    !isUuid(value.recorded_by) ||
    !isTimestamp(value.created_at)
  ) {
    return null;
  }
  if (
    value.entry_type === "receipt"
      ? typeof value.depositor_name !== "string" ||
        value.depositor_name.trim().length === 0 ||
        value.reversal_of !== null
      : value.depositor_name !== null || !isUuid(value.reversal_of)
  ) {
    return null;
  }
  const depositorName = typeof value.depositor_name === "string"
    ? value.depositor_name
    : null;
  const reversalOf = isUuid(value.reversal_of) ? value.reversal_of : null;
  return {
    id: value.id,
    entry_type: value.entry_type,
    amount: value.amount,
    depositor_name: depositorName,
    memo: value.memo,
    reversal_of: reversalOf,
    recorded_by: value.recorded_by,
    created_at: value.created_at,
  };
}

const TRANSFER_KEYS = [
  "id",
  "order_id",
  "member_id",
  "expected_amount",
  "status",
  "bank_name_snapshot",
  "account_number_snapshot",
  "requested_at",
  "confirmed_at",
  "confirmed_by",
  "activity_at",
  "received_amount",
  "ledger_entry_count",
  "remaining_amount",
  "ledger_history_complete",
  "ledger",
] as const;

function parseQueueTransfer(
  value: unknown,
  lane: "active" | "history",
): QueueTransfer | null {
  if (!isRecord(value) || !hasExactlyKeys(value, TRANSFER_KEYS)) return null;
  const status = value.status;
  if (
    !isUuid(value.id) ||
    !isUuid(value.order_id) ||
    !isUuid(value.member_id) ||
    !isSafeInteger(value.expected_amount, 1) ||
    typeof value.bank_name_snapshot !== "string" ||
    value.bank_name_snapshot.trim().length === 0 ||
    typeof value.account_number_snapshot !== "string" ||
    value.account_number_snapshot.trim().length === 0 ||
    !isTimestamp(value.requested_at) ||
    !isTimestamp(value.activity_at) ||
    !isSafeInteger(value.received_amount) ||
    !isSafeInteger(value.ledger_entry_count) ||
    !isSafeInteger(value.remaining_amount) ||
    typeof value.ledger_history_complete !== "boolean" ||
    !Array.isArray(value.ledger) ||
    value.ledger.length > LEDGER_DISPLAY_LIMIT
  ) {
    return null;
  }
  if (
    lane === "active"
      ? status !== "awaiting_transfer" && status !== "partially_paid"
      : status !== "confirmed" && status !== "cancelled"
  ) {
    return null;
  }
  const parsedStatus = status as QueueStatus;
  const confirmedAt = value.confirmed_at;
  const confirmedBy = value.confirmed_by;
  if (
    (confirmedAt !== null && !isTimestamp(confirmedAt)) ||
    (confirmedBy !== null && !isUuid(confirmedBy))
  ) {
    return null;
  }
  const expectedAmount = value.expected_amount;
  const receivedAmount = value.received_amount;
  const ledgerEntryCount = value.ledger_entry_count;
  if (
    receivedAmount > expectedAmount ||
    value.remaining_amount !== expectedAmount - receivedAmount ||
    (status === "awaiting_transfer" && receivedAmount !== 0) ||
    (status === "partially_paid" &&
      (receivedAmount <= 0 || receivedAmount >= expectedAmount)) ||
    (status === "confirmed" && receivedAmount !== expectedAmount) ||
    (status === "cancelled" && receivedAmount !== 0)
  ) {
    return null;
  }

  const ledger = value.ledger.map(parseLedgerEntry);
  if (ledger.some((entry) => entry === null)) return null;
  const parsedLedger = ledger as QueueLedgerEntry[];
  const ledgerIds = new Set(parsedLedger.map((entry) => entry.id));
  const activityKey = timestampSortKey(value.activity_at);
  const requestedKey = timestampSortKey(value.requested_at);
  const confirmedKey = confirmedAt === null ? null : timestampSortKey(confirmedAt);
  const newestLedgerKey = parsedLedger.length === 0
    ? null
    : timestampSortKey(parsedLedger[0].created_at);
  const expectedActivityKey = [requestedKey, confirmedKey, newestLedgerKey]
    .filter((key): key is bigint => key !== null)
    .reduce((latest, key) => key > latest ? key : latest);
  let completeSignedAmount = 0;
  if (value.ledger_history_complete) {
    for (const entry of parsedLedger) {
      completeSignedAmount += entry.entry_type === "receipt" ? entry.amount : -entry.amount;
      if (!Number.isSafeInteger(completeSignedAmount)) return null;
    }
  }
  if (
    activityKey === null ||
    requestedKey === null ||
    (confirmedAt !== null && confirmedKey === null) ||
    ledgerIds.size !== parsedLedger.length ||
    parsedLedger.length > ledgerEntryCount ||
    value.ledger_history_complete !== (parsedLedger.length === ledgerEntryCount) ||
    (!value.ledger_history_complete &&
      (parsedLedger.length !== LEDGER_DISPLAY_LIMIT || ledgerEntryCount <= LEDGER_DISPLAY_LIMIT)) ||
    !rowsAreStrictlyDescending(
      parsedLedger.map((entry) => ({ id: entry.id, timestamp: entry.created_at })),
    ) ||
    parsedLedger.some(
      (entry) => {
        const entryKey = timestampSortKey(entry.created_at);
        return entryKey === null || entryKey > activityKey;
      },
    ) ||
    activityKey !== expectedActivityKey ||
    (value.ledger_history_complete && completeSignedAmount !== receivedAmount)
  ) {
    return null;
  }

  return {
    id: value.id,
    order_id: value.order_id,
    member_id: value.member_id,
    expected_amount: expectedAmount,
    status: parsedStatus,
    bank_name_snapshot: value.bank_name_snapshot,
    account_number_snapshot: value.account_number_snapshot,
    requested_at: value.requested_at,
    confirmed_at: confirmedAt,
    confirmed_by: confirmedBy,
    activityAt: value.activity_at,
    receivedAmount,
    ledgerEntryCount,
    ledgerHistoryComplete: value.ledger_history_complete,
    remainingAmount: value.remaining_amount,
    ledger: parsedLedger,
  };
}

const SNAPSHOT_KEYS = [
  "active_overflow",
  "integrity_error",
  "active_count",
  "active",
  "history",
  "history_has_more",
  "next_history_cursor",
] as const;

function parseQueueSnapshot(
  value: unknown,
  summaryOnly: boolean,
  requestCursor: HistoryCursor | null,
): QueueSnapshot | null {
  if (!isRecord(value) || !hasExactlyKeys(value, SNAPSHOT_KEYS)) return null;
  if (
    typeof value.active_overflow !== "boolean" ||
    typeof value.integrity_error !== "boolean" ||
    !isSafeInteger(value.active_count) ||
    value.active_count > 401 ||
    !Array.isArray(value.active) ||
    !Array.isArray(value.history) ||
    typeof value.history_has_more !== "boolean"
  ) {
    return null;
  }
  const activeOverflow = value.active_overflow;
  const integrityError = value.integrity_error;
  const activeCount = value.active_count;
  const active = value.active.map((transfer) => parseQueueTransfer(transfer, "active"));
  const history = value.history.map((transfer) => parseQueueTransfer(transfer, "history"));
  if (active.some((transfer) => transfer === null) || history.some((transfer) => transfer === null)) {
    return null;
  }
  const parsedActive = active as QueueTransfer[];
  const parsedHistory = history as QueueTransfer[];
  const allIds = [...parsedActive, ...parsedHistory].map((transfer) => transfer.id);
  if (
    activeOverflow !== (activeCount > 400) ||
    new Set(allIds).size !== allIds.length ||
    parsedHistory.length > HISTORY_PAGE_SIZE ||
    !rowsAreStrictlyDescending(
      parsedActive.map((transfer) => ({ id: transfer.id, timestamp: transfer.activityAt })),
    ) ||
    !rowsAreStrictlyDescending(
      parsedHistory.map((transfer) => ({ id: transfer.id, timestamp: transfer.activityAt })),
    ) ||
    (requestCursor !== null && parsedHistory.some((transfer) =>
      !tupleIsStrictlyBefore(
        { id: transfer.id, timestamp: transfer.activityAt },
        requestCursor,
      )
    ))
  ) {
    return null;
  }

  let nextHistoryCursor: HistoryCursor | null = null;
  if (value.next_history_cursor !== null) {
    if (
      !isRecord(value.next_history_cursor) ||
      !hasExactlyKeys(value.next_history_cursor, ["activity_at", "transfer_id"]) ||
      !isTimestamp(value.next_history_cursor.activity_at) ||
      !isUuid(value.next_history_cursor.transfer_id)
    ) {
      return null;
    }
    nextHistoryCursor = {
      activityAt: value.next_history_cursor.activity_at,
      transferId: value.next_history_cursor.transfer_id,
    };
  }

  const mustBeEmpty = activeOverflow || integrityError || summaryOnly;
  if (
    (mustBeEmpty &&
      (parsedActive.length !== 0 ||
        parsedHistory.length !== 0 ||
        value.history_has_more ||
        nextHistoryCursor !== null)) ||
    (!mustBeEmpty && parsedActive.length !== activeCount) ||
    (value.history_has_more &&
      (parsedHistory.length !== HISTORY_PAGE_SIZE ||
        nextHistoryCursor === null ||
        nextHistoryCursor.activityAt !== parsedHistory.at(-1)?.activityAt ||
        nextHistoryCursor.transferId !== parsedHistory.at(-1)?.id)) ||
    (!value.history_has_more && nextHistoryCursor !== null)
  ) {
    return null;
  }

  return {
    activeOverflow,
    integrityError,
    activeCount,
    active: parsedActive,
    history: parsedHistory,
    historyHasMore: value.history_has_more,
    nextHistoryCursor,
  };
}

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const allowed = new Set(["summary", "before", "beforeId"]);
  if ([...searchParams.keys()].some((key) => !allowed.has(key))) return null;
  for (const key of allowed) {
    if (searchParams.getAll(key).length > 1) return null;
  }
  const summaryValue = searchParams.get("summary");
  if (summaryValue !== null && summaryValue !== "1") return null;
  const summaryOnly = summaryValue === "1";
  const before = searchParams.get("before");
  const beforeId = searchParams.get("beforeId");
  if ((before === null) !== (beforeId === null)) return null;
  if (before !== null && (!isTimestamp(before) || !isUuid(beforeId))) return null;
  if (summaryOnly && before !== null) return null;
  return { before, beforeId, summaryOnly };
}

const SUMMARY_KEYS = [
  "order_id",
  "member_id",
  "order_status",
  "total",
  "created_at",
  "item_count",
  "items",
] as const;
const ITEM_KEYS = [
  "order_id",
  "product_id",
  "unit_price",
  "payment_status",
  "products",
  "commerce_orders",
] as const;

function orderStatusMatchesTransfer(
  orderStatus: string,
  transferStatus: QueueStatus,
) {
  if (transferStatus === "awaiting_transfer") return orderStatus === "awaiting_payment";
  if (transferStatus === "partially_paid") return orderStatus === "partially_paid";
  if (transferStatus === "confirmed") return orderStatus === "paid" || orderStatus === "shipped";
  return orderStatus === "cancelled";
}

function itemStatusMatchesTransfer(
  paymentStatus: string,
  transferStatus: QueueStatus,
) {
  if (transferStatus === "confirmed") return paymentStatus === "paid";
  if (transferStatus === "cancelled") return paymentStatus === "cancelled";
  return paymentStatus === "awaiting_payment";
}

function parseOrderItems(
  value: unknown,
  transfers: QueueTransfer[],
): Map<string, OrderItem[]> | null {
  if (!Array.isArray(value) || value.length !== transfers.length) return null;
  const transferByOrder = new Map(transfers.map((transfer) => [transfer.order_id, transfer]));
  if (transferByOrder.size !== transfers.length) return null;
  const itemsByOrder = new Map<string, OrderItem[]>();

  for (const summary of value) {
    if (!isRecord(summary) || !hasExactlyKeys(summary, SUMMARY_KEYS)) return null;
    const transfer = typeof summary.order_id === "string"
      ? transferByOrder.get(summary.order_id)
      : undefined;
    if (
      !transfer ||
      !isUuid(summary.member_id) ||
      summary.member_id !== transfer.member_id ||
      typeof summary.order_status !== "string" ||
      !orderStatusMatchesTransfer(summary.order_status, transfer.status) ||
      !isSafeInteger(summary.total, 1) ||
      summary.total !== transfer.expected_amount ||
      !isTimestamp(summary.created_at) ||
      !isSafeInteger(summary.item_count, 1) ||
      summary.item_count > 50 ||
      !Array.isArray(summary.items) ||
      summary.items.length !== summary.item_count ||
      itemsByOrder.has(transfer.order_id)
    ) {
      return null;
    }

    const parsedItems: OrderItem[] = [];
    const productIds = new Set<string>();
    for (const item of summary.items) {
      if (!isRecord(item) || !hasExactlyKeys(item, ITEM_KEYS)) return null;
      if (
        item.order_id !== transfer.order_id ||
        !isUuid(item.product_id) ||
        !isSafeInteger(item.unit_price, 1) ||
        typeof item.payment_status !== "string" ||
        !itemStatusMatchesTransfer(item.payment_status, transfer.status) ||
        !isRecord(item.commerce_orders) ||
        !hasExactlyKeys(item.commerce_orders, ["member_id", "status", "total", "created_at"]) ||
        item.commerce_orders.member_id !== transfer.member_id ||
        typeof item.commerce_orders.status !== "string" ||
        item.commerce_orders.status !== summary.order_status ||
        item.commerce_orders.total !== transfer.expected_amount ||
        !isTimestamp(item.commerce_orders.created_at) ||
        item.commerce_orders.created_at !== summary.created_at ||
        productIds.has(item.product_id)
      ) {
        return null;
      }
      let products: OrderItem["products"] = null;
      if (item.products !== null) {
        if (
          !isRecord(item.products) ||
          !hasExactlyKeys(item.products, ["title", "image_urls"]) ||
          typeof item.products.title !== "string" ||
          !Array.isArray(item.products.image_urls) ||
          item.products.image_urls.some((image) => typeof image !== "string")
        ) {
          return null;
        }
        products = {
          title: item.products.title,
          image_urls: item.products.image_urls.map((image) =>
            getCatalogImageUrl(image as string, 320)
          ),
        };
      }
      productIds.add(item.product_id);
      parsedItems.push({
        order_id: transfer.order_id,
        product_id: item.product_id,
        unit_price: item.unit_price,
        payment_status: item.payment_status,
        products,
        commerce_orders: {
          member_id: transfer.member_id,
          status: item.commerce_orders.status,
          total: item.commerce_orders.total as number,
          created_at: item.commerce_orders.created_at,
        },
      });
    }
    itemsByOrder.set(transfer.order_id, parsedItems);
  }

  return itemsByOrder.size === transfers.length ? itemsByOrder : null;
}

export async function GET(request: Request) {
  const auth = await authenticateStaffRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.roleCode !== "owner" && auth.roleCode !== "operator") {
    return commerceJson({ error: "forbidden" }, 403);
  }

  const query = parseQuery(request);
  if (!query) return commerceJson({ error: "invalid_operator_orders_query" }, 400);

  const { data, error } = await auth.user.rpc(
    "get_shared_commerce_payment_queue_page",
    {
      p_history_before_activity_at: query.before ?? undefined,
      p_history_before_transfer_id: query.beforeId ?? undefined,
      p_history_limit: HISTORY_PAGE_SIZE,
      p_summary_only: query.summaryOnly,
    },
  );
  if (error) return commerceJson({ error: "operator_orders_unavailable" }, 503);

  const requestCursor = query.before && query.beforeId
    ? { activityAt: query.before, transferId: query.beforeId }
    : null;
  const snapshot = parseQueueSnapshot(data, query.summaryOnly, requestCursor);
  if (!snapshot) return commerceJson({ error: "operator_orders_unavailable" }, 503);
  if (snapshot.activeOverflow) {
    return commerceJson({ error: "operator_orders_queue_limit_exceeded" }, 503);
  }
  if (snapshot.integrityError) {
    return commerceJson({ error: "operator_orders_snapshot_integrity_error" }, 503);
  }
  if (query.summaryOnly) return commerceJson({ activeCount: snapshot.activeCount });

  const transfers = [...snapshot.active, ...snapshot.history];
  const orderIds = transfers.map((transfer) => transfer.order_id);
  const summaryResult = orderIds.length === 0
    ? { data: [], error: null }
    : await auth.user.rpc("get_shared_commerce_payment_order_summaries", {
      p_order_ids: orderIds,
    });
  if (summaryResult.error) {
    return commerceJson({ error: "operator_orders_unavailable" }, 503);
  }
  const itemsByOrder = parseOrderItems(summaryResult.data, transfers);
  if (!itemsByOrder) {
    return commerceJson({ error: "operator_orders_unavailable" }, 503);
  }
  const withItems = (queueTransfers: QueueTransfer[]) =>
    queueTransfers.map((transfer) => ({
      ...transfer,
      items: itemsByOrder.get(transfer.order_id) ?? [],
    }));

  return commerceJson({
    activeCount: snapshot.activeCount,
    activeTransfers: withItems(snapshot.active),
    historyTransfers: withItems(snapshot.history),
    historyHasMore: snapshot.historyHasMore,
    nextHistoryCursor: snapshot.nextHistoryCursor,
  });
}
