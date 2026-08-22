import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("GNB user menu exposes exactly the four account actions and canonical MY routes", async () => {
  const [menu, auth, toolbar, dashboard, orders, vault] = await Promise.all([
    read("src/components/layout/UserMenuDropdown.tsx"),
    read("src/components/layout/AuthStatus.tsx"),
    read("src/components/features/commerce/CommerceToolbar.tsx"),
    read("src/components/features/mypage/MyDashboard.tsx"),
    read("src/app/(shop)/my/orders/page.tsx"),
    read("src/app/(shop)/my/vault/page.tsx"),
  ]);

  assert.match(auth, /<UserMenuDropdown basePath=\{basePath\} session=\{session\} \/>/);
  assert.match(menu, /> 내 정보<\/Link>/);
  assert.match(menu, /> 주문·배송<\/Link>/);
  assert.match(menu, /> 보관함<\/Link>/);
  assert.match(menu, /> 로그아웃<\/button>/);
  assert.match(menu, /@radix-ui\/react-dropdown-menu/);
  assert.match(menu, /<DropdownMenu\.Root/);
  assert.match(menu, /<DropdownMenu\.Content/);
  assert.match(menu, /로그아웃하시겠습니까\?/);
  assert.match(toolbar, /href="\/wishlist"/);
  assert.match(toolbar, /href="\/cart"/);
  assert.match(dashboard, /`\/my\/\$\{tab\}`/);
  assert.match(orders, /initialTab="orders"/);
  assert.match(vault, /initialTab="vault"/);
});
