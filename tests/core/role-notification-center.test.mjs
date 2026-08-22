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
    "AUCTION_DROP_ALERT",
    "VAULT_EXPIRING_SOON",
    "ORDER_SHIPPED",
    "NOTICE_GENERAL",
    "SELLER_NEW_SALE",
    "SELLER_SHIPPING_REQUEST",
    "SELLER_NEW_INQUIRY",
    "OWNER_DEPOSIT_VERIFY",
    "OWNER_SETTLEMENT_REQUEST",
    "OWNER_SECURITY_ALERT",
  ]) assert.match(types, new RegExp(`\\"${type}\\"`));

  assert.match(types, /id: "OPERATOR_SALES", label: "판매·출고".+roles: \["operator", "employee", "owner"\]/);
  assert.match(types, /id: "OWNER_SETTLEMENT", label: "정산·시스템".+roles: \["owner"\]/);
  assert.match(types, /category === "OWNER_SETTLEMENT" && viewerRole !== "owner"/);
  assert.match(types, /category === "OPERATOR_SALES" && !\["owner", "operator", "employee"\]\.includes\(viewerRole\)/);
  assert.match(route, /filter\(\(item\) => canViewNotification\(viewerRole, item\.audience_role, item\.kind\)\)/);
  assert.match(route, /getVisibleNotificationAudiences\(viewerRole\)/);
  assert.match(center, /getVisibleNotificationTabs\(viewerRole\)/);
  assert.match(center, /canViewNotification\(viewerRole, audienceRole, item\.kind\)/);
  assert.match(center, /getNotificationFallbackHref\(item\.kind\)/);
  assert.match(center, /filter: `member_id=eq\.\$\{userId\}`/);
  assert.match(types, /case "SELLER_SHIPPING_REQUEST": return "\/admin\/operator\/vault"/);
  assert.match(types, /case "OWNER_DEPOSIT_VERIFY": return "\/admin\/owner\/settlements\?tab=deposits"/);
});
