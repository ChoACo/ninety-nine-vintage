import { commerceJson } from "@/lib/commerce/server";

const retired = () => commerceJson({
  error: "operator_fulfillment_retired",
  message: "별도 입고 처리는 폐기되었습니다. 보관 기간은 결제 완료 시점부터 시작됩니다.",
}, 410);

export function GET() {
  return retired();
}

export function POST() {
  return retired();
}
