import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("notification center keeps customer, seller, and owner categories role-scoped", async () => {
  const [types, route, center] = await Promise.all([
    read("src/lib/notifications/types.ts"),
    read("src/app/api/notifications/route.ts"),
    read("src/components/features/notifications/NotificationCenterButton.tsx"),
  ]);

  for (const type of [
    "AUCTION_OUTBID",
    "AUCTION_WON",
    "VAULT_EXPIRING",
    "ORDER_SHIPPED",
    "NOTICE_GENERAL",
    "SELLER_NEW_SALE",
    "SELLER_SHIPPING_REQUEST",
    "SELLER_NEW_INQUIRY",
    "OWNER_DEPOSIT_VERIFY",
    "OWNER_SETTLEMENT_REQ",
  ]) assert.match(types, new RegExp(`\\"${type}\\"`));

  assert.match(types, /id: "seller", label: "판매·출고", roles: \["operator", "employee", "owner"\]/);
  assert.match(types, /id: "owner", label: "정산·관리", roles: \["owner"\]/);
  assert.match(route, /filter\(\(item\) => canViewNotification\(viewerRole, item\.audience_role\)\)/);
  assert.match(route, /getVisibleNotificationAudiences\(viewerRole\)/);
  assert.match(center, /getVisibleNotificationTabs\(viewerRole\)/);
  assert.match(center, /canViewNotification\(viewerRole, audienceRole\)/);
  assert.match(center, /getNotificationFallbackHref\(item\.kind\)/);
});
