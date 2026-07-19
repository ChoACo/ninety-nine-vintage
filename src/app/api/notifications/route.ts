export async function GET() {
  return Response.json({ notifications: [{ id: "notice-1", kind: "storage_expiring", title: "보관 기간이 얼마 남지 않았어요", body: "90s Varsity Leather Jacket의 배송 요청 가능 기간이 9일 남았습니다.", href: "/account#storage", readAt: null }] }, { headers: { "Cache-Control": "no-store" } });
}

