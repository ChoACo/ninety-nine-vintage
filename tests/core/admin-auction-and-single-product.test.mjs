import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("owner product feed exposes an audited immediate auction close and winner action", async () => {
  const [consoleSource, closeRoute, productsRoute, migration] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/[id]/close-now/route.ts"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("supabase/migrations/20260718061000_add_auction_lifecycle_controls.sql"),
  ]);

  assert.match(productsRoute, /canCloseAuctions:\s*auth\.roleCode === "owner"/);
  assert.match(consoleSource, /즉시 마감·낙찰 확정/);
  assert.match(consoleSource, /permissions\.canCloseAuctions/);
  assert.match(consoleSource, /\/close-now/);
  assert.match(closeRoute, /authenticateStaffRequest\(request,\s*true\)/);
  assert.match(closeRoute, /auth\.roleCode !== "owner"/);
  assert.match(closeRoute, /auth\.user[\s\S]*\.rpc\("owner_close_auction_now"/);
  assert.doesNotMatch(closeRoute, /auth\.admin[\s\S]*\.from\("products"\)/);
  assert.match(migration, /order by bids\.amount desc,\s*bids\.created_at,\s*bids\.id/i);
  assert.match(migration, /owner_auction_action_audit/i);
});

test("single product registration is separate, scheduled for next-day 10 by default, and uploads up to 15 ordered files", async () => {
  const [consoleSource, route, dashboard, categoryMigration] = await Promise.all([
    source("src/components/admin/operator/OperatorProductsConsole.tsx"),
    source("src/app/api/admin/operator/products/route.ts"),
    source("src/components/admin/operator/OperatorConsole.tsx"),
    source("supabase/migrations/20260724010000_remove_legacy_used_clothing_category.sql"),
  ]);

  assert.match(consoleSource, /엑셀 일괄 등록[\s\S]*variant="primary"/);
  assert.match(consoleSource, /단품 등록/);
  assert.match(consoleSource, /useState<PublicationMode>\("next-day-10"\)/);
  assert.match(consoleSource, /다음 날 오전 10시 공개 \(기본\)/);
  assert.match(consoleSource, /singleImages\.length \+ selected\.length > 15/);
  assert.match(consoleSource, /type="file"/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*-1\)/);
  assert.match(consoleSource, /moveSingleImage\(index,\s*1\)/);
  assert.match(consoleSource, /removeSingleImage\(image\.id\)/);
  assert.match(consoleSource, /singleImages\.map\(\(image\) => image\.file\)/);

  assert.match(route, /registrationMode === "single"/);
  assert.match(route, /formatProductDisplayNumber\(productId\)/);
  assert.match(route, /singleRegistration \? "기타"/);
  assert.match(route, /getRelativeKoreanDateTime\(1,\s*"10:00:00"/);
  assert.match(route, /value\.length > 15/);
  assert.match(route, /p_permission:\s*"publish_products"/);
  assert.match(route, /size_label:\s*singleRegistration \? ""/);
  assert.match(route, /inspection_notes:\s*singleRegistration[\s\S]*\?\s*\[\]/);
  assert.doesNotMatch(route, /구제 의류/);
  assert.match(categoryMigration, /alter column category set default '기타'/);
  assert.match(categoryMigration, /where btrim\(category\) in \('구제 의류', '구제의류'\)/);

  assert.match(dashboard, /products\?import=xlsx/);
  assert.match(dashboard, /products\?create=single/);
});
