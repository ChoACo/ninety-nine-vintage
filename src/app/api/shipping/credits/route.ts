import { commerceJson } from "@/lib/commerce/server";

/** 배송 크레딧은 다중 센터 배송비 정책으로 폐기되었습니다. */
export async function GET() {
  return commerceJson({ error: "shipping_credit_retired", message: "배송 크레딧은 폐기되었습니다. 배송비는 센터별 주문·배송 요청에서 처리합니다." }, 410);
}

export async function POST() {
  return commerceJson({ error: "shipping_credit_retired", message: "배송 크레딧은 폐기되었습니다. 배송비는 센터별 주문·배송 요청에서 처리합니다." }, 410);
}

export async function DELETE() {
  return commerceJson({ error: "shipping_credit_retired", message: "배송 크레딧은 폐기되었습니다. 배송비는 센터별 주문·배송 요청에서 처리합니다." }, 410);
}
