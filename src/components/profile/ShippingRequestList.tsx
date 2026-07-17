import type { WonAuction } from "@/src/types/auction";

import { ShipmentStatusBoard } from "./ShipmentStatusBoard";

interface ShippingRequestListProps {
  /** 이전 호출부와의 호환용 별칭입니다. 새 호출부는 requestedItems를 사용하세요. */
  items?: readonly WonAuction[];
  requestedItems?: readonly WonAuction[];
  shippedItems?: readonly WonAuction[];
  onNotify?: (message: string) => void;
}

/**
 * 기존 컴포넌트 이름을 유지하면서 발송 대기/발송 완료를 50:50로 보여 줍니다.
 * TODO: DB 연동 필요 — requestedItems와 shippedItems는 서버 발송 상태별 조회 결과로 교체합니다.
 */
export function ShippingRequestList({
  items = [],
  requestedItems,
  shippedItems = [],
  onNotify,
}: ShippingRequestListProps) {
  return (
    <ShipmentStatusBoard
      requestedItems={requestedItems ?? items}
      shippedItems={shippedItems}
      onNotify={onNotify}
    />
  );
}
