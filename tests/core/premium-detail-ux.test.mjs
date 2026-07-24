import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clampTransform,
  fitContain,
  panBy,
  pinchTransform,
  zoomAtPoint,
} from "../../src/lib/images/panZoomMath.ts";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");
const bounds = {
  contentHeight: 600,
  contentWidth: 800,
  maxScale: 4,
  minScale: 1,
  viewportHeight: 600,
  viewportWidth: 800,
};

test("pan and zoom preserve the cursor anchor and clamp image edges", () => {
  const initial = { scale: 1, x: 0, y: 0 };
  const anchor = { x: 120, y: -80 };
  const zoomed = zoomAtPoint(initial, 2, anchor, bounds);
  assert.deepEqual(zoomed, { scale: 2, x: -120, y: 80 });
  assert.equal(zoomed.x + anchor.x * zoomed.scale, anchor.x);
  assert.equal(zoomed.y + anchor.y * zoomed.scale, anchor.y);

  assert.deepEqual(panBy(zoomed, { x: 10_000, y: -10_000 }, bounds), {
    scale: 2,
    x: 400,
    y: -300,
  });
  assert.deepEqual(clampTransform({ scale: 99, x: Infinity, y: NaN }, bounds), {
    scale: 4,
    x: 0,
    y: 0,
  });
});

test("contain fitting and pinch transforms stay finite at malformed gesture boundaries", () => {
  assert.deepEqual(fitContain(800, 600, 4_000, 3_000), {
    width: 800,
    height: 600,
  });
  assert.deepEqual(fitContain(800, 600, 1_000, 2_000), {
    width: 300,
    height: 600,
  });
  assert.deepEqual(fitContain(Number.NaN, 600, 1_000, Number.POSITIVE_INFINITY), {
    width: 1,
    height: 600,
  });
  const pinched = pinchTransform(
    { scale: 2, x: 10, y: -20 },
    { x: 0, y: 0 },
    { x: 40, y: 30 },
    0,
    bounds,
  );
  assert.deepEqual(pinched, { scale: 2, x: 50, y: 10 });
  assert.equal(Object.values(pinched).every(Number.isFinite), true);
  const malformedBounds = clampTransform(
    { scale: 2, x: 10, y: -10 },
    { ...bounds, contentWidth: Number.NaN, viewportHeight: Number.POSITIVE_INFINITY },
  );
  assert.equal(Object.values(malformedBounds).every(Number.isFinite), true);
});

test("premium detail actions stay in layered rounded dialogs before server mutation", async () => {
  const [styles, modal, routeModal, condition, cart, bid, gallery, catalogImage, sticky, scrollLock] = await Promise.all([
    source("src/app/globals.css"),
    source("src/components/ui/PremiumDialog.tsx"),
    source("src/components/layout/ModalShell.tsx"),
    source("src/components/features/auction/detail/ConditionReport.tsx"),
    source("src/components/features/auction/detail/QuickCartModal.tsx"),
    source("src/components/features/auction/detail/AuctionBidRoutePanel.tsx"),
    source("src/components/features/auction/AuctionGalleryModal.tsx"),
    source("src/components/ui/CatalogImage.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/lib/browser/bodyScrollLock.ts"),
  ]);

  assert.match(styles, /premium-surface-in/);
  assert.match(styles, /premium-surface-out/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(modal, /rounded-3xl/);
  assert.match(modal, /bg-black\/60/);
  assert.match(modal, /backdrop-blur-md/);
  assert.match(modal, /event\.stopImmediatePropagation\(\)/);
  assert.match(modal, /modalLayers\.item\(modalLayers\.length - 1\)/);
  assert.match(routeModal, /document\.querySelector\('\[data-premium-modal-layer="nested"\]'\)/);
  assert.match(modal, /createPortal/);
  assert.match(modal, /lockBodyScroll/);
  assert.match(condition, /PremiumDialog/);
  assert.match(condition, /상품 상태 상세 보기/);
  assert.match(condition, /상품 상태 정보/);
  assert.match(condition, /상태 등급 \{item\.conditionGrade \|\| "미입력"\}/);
  assert.doesNotMatch(condition, /전문가 검수 완료|정품·상태 확인|검수 보고서|상세 보고서|BadgeCheck/);
  assert.match(cart, /PremiumDialog/);
  assert.match(cart, /간편 장바구니/);
  assert.match(bid, /setConfirmOpen\(true\)/);
  assert.match(bid, /동의하고 최종 입찰/);
  const confirmationRequest = bid.slice(
    bid.indexOf("const requestConfirmation"),
    bid.indexOf("const submit"),
  );
  const confirmedSubmission = bid.slice(
    bid.indexOf("const submit"),
    bid.indexOf("return ("),
  );
  assert.doesNotMatch(confirmationRequest, /fetch\(/);
  assert.match(confirmationRequest, /setConfirmOpen\(true\)/);
  assert.match(confirmedSubmission, /fetch\("\/api\/auction\/bids"/);
  assert.match(confirmedSubmission, /!agreed \|\| !session\?\.access_token/);
  const successfulBidClose = confirmedSubmission.slice(
    confirmedSubmission.indexOf("if (!response.ok"),
    confirmedSubmission.indexOf("} catch"),
  );
  assert.match(
    successfulBidClose,
    /setConfirmOpen\(false\);[\s\S]*window\.dispatchEvent\(new Event\("ninety-nine:close-route-modal"\)\)/,
  );
  assert.match(
    routeModal,
    /window\.addEventListener\("ninety-nine:close-route-modal", onRequestedClose\)/,
  );
  assert.match(routeModal, /const onRequestedClose = \(\) => close\(\)/);
  assert.match(gallery, /touch-none/);
  assert.match(gallery, /event\.pointerType === "mouse"/);
  assert.match(gallery, /event\.pointerType === "touch"/);
  assert.match(gallery, /data-gallery-index=/);
  assert.match(gallery, /createPortal/);
  assert.match(gallery, /lockBodyScroll/);
  assert.match(gallery, /galleryActionsRef\.current/);
  assert.match(gallery, /event\.target\.closest\("button, a, input, select, textarea"\)/);
  assert.match(gallery, /modalLayers\.item\(modalLayers\.length - 1\) !== dialogRef\.current/);
  assert.match(gallery, /\}, \[rendered\]\);/);
  assert.match(gallery, /aria-current=\{visibleIndex === index/);
  assert.match(gallery, /className="grid size-11 shrink-0 place-items-center/);
  assert.match(gallery, /safe-area-inset-left/);
  assert.match(catalogImage, /props\.unoptimized\s*\?\s*undefined/);
  const quickCartAction = sticky.slice(
    sticky.indexOf("const addFixedToCart"),
    sticky.indexOf("const buyNow"),
  );
  assert.match(
    quickCartAction,
    /reserveCartProduct\(item\.id, session\.user\.id\)[\s\S]*addToCart\(item\.id\)[\s\S]*setCartReserved\(true\)/,
  );
  assert.match(quickCartAction, /setQuickCartOpen\(false\)/);
  assert.doesNotMatch(quickCartAction, /router\.push\("\/cart"\)/);
  assert.match(sticky, /surface === "desktop"[\s\S]*sticky col-span-5 p-6 pb-6[\s\S]*: "p-5 pb-32"/);
  assert.match(scrollLock, /activeBodyScrollLocks \+= 1/);
  assert.match(scrollLock, /activeBodyScrollLocks === 0/);
});

test("fixed navigation and operator dialogs share the accessible portaled lifecycle", async () => {
  const [dialog, mobileHeader, mobileFilters, operatorImport] = await Promise.all([
    source("src/components/ui/PremiumDialog.tsx"),
    source("src/components/layout/MobileHeader.tsx"),
    source("src/components/features/auction/AuctionFilterSidebar.tsx"),
    source("src/components/admin/operator/OperatorXlsxImportModal.tsx"),
  ]);

  assert.match(dialog, /EXIT_DURATION_MS = 180/);
  assert.match(dialog, /createPortal\([\s\S]*document\.body/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(dialog, /lockBodyScroll\(\)/);
  assert.match(dialog, /"drawer-left"/);
  assert.match(dialog, /"sheet-bottom"/);

  assert.match(mobileHeader, /<PremiumDialog/);
  assert.match(mobileHeader, /aria-expanded=\{open\} aria-haspopup="dialog"/);
  assert.match(mobileHeader, /placement="drawer-left"/);
  assert.doesNotMatch(mobileHeader, /document\.body\.style\.overflow/);

  assert.match(mobileFilters, /<PremiumDialog/);
  assert.match(mobileFilters, /aria-expanded=\{mobileOpen\}[\s\S]*aria-haspopup="dialog"/);
  assert.match(mobileFilters, /placement="sheet-bottom"/);
  assert.doesNotMatch(mobileFilters, /mobileOpen &&\s*<PremiumDialog/);

  assert.match(operatorImport, /<PremiumDialog/);
  assert.match(operatorImport, /closeDisabled=\{isSubmitting\}/);
  assert.doesNotMatch(operatorImport, /window\.addEventListener\("keydown"/);
  assert.doesNotMatch(operatorImport, /document\.body\.style\.overflow/);
});
