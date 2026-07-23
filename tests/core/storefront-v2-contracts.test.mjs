import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the storefront renders separate mobile and fixed desktop presentation trees", async () => {
  const [home, mobileHome, layout, mobileLayout, header, productRail, css] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
    source("src/components/layout/PcLayout.tsx"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/layout/PcHeader.tsx"),
    source("src/components/features/catalog/ProductRail.tsx"),
    source("src/app/globals.css"),
  ]);

  assert.match(home, /function DesktopHome\(/);
  assert.doesNotMatch(home, /MobileHome|md:hidden|data-home-presentation="mobile"/);
  assert.match(home, /<DesktopHome auctions=\{auctions\}/);
  assert.match(mobileHome, /data-mobile-home/);
  assert.match(mobileHome, /basePath="\/m"/);
  assert.match(layout, /<PcHeader hasLiveTicker=\{LIVE_AUCTION_ENABLED\} \/>/);
  assert.match(layout, /data-ui-surface="desktop"/);
  assert.match(layout, /w-\[1280px\]/);
  assert.match(layout, /min-w-\[1280px\]/);
  assert.match(layout, /data-desktop-canvas="1280"/);
  assert.match(layout, /w-\[1200px\]/);
  assert.match(layout, /data-desktop-content="1200"/);
  assert.doesNotMatch(layout, /MobileHeader|MobileBottomNav|md:hidden/);
  assert.match(header, /w-\[1200px\]/);
  assert.match(header, /form className="flex h-10 w-40/);
  assert.doesNotMatch(header, /(?:sm|md|lg|xl):/);
  assert.match(productRail, /surface === "desktop" \? "grid grid-cols-3 gap-2"/);
  assert.match(productRail, /surface === "desktop" \? "grid grid-cols-5 gap-x-3 gap-y-9"/);
  assert.doesNotMatch(home, /clamp\(|(?:sm|md|lg|xl):/);
  assert.match(home, /text-\[6\.5rem\]/);
  assert.match(home, /"only screen and \(max-width: 1279px\)": "\/m\/home"/);
  assert.match(css, /\[data-ui-surface="desktop"\][\s\S]*word-break: keep-all/);
  assert.match(mobileLayout, /data-ui-surface="mobile"/);
  assert.match(mobileLayout, /<MobileSiteHeader hasLiveTicker=\{LIVE_AUCTION_ENABLED\} \/>/);
  assert.match(mobileLayout, /<MobileSiteBottomNav \/>/);
  assert.doesNotMatch(mobileLayout, /PcHeader|PcFooter|PcLayout/);
});

test("product, login, and bid navigation support intercepted modals and direct full pages", async () => {
  const [
    shopLayout,
    defaultModal,
    modalShell,
    interceptedProduct,
    directProduct,
    interceptedLogin,
    directLogin,
    interceptedBid,
    directBid,
    stickyBidPanel,
    feedCard,
    auctionCard,
    detailView,
  ] = await Promise.all([
    source("src/app/(shop)/layout.tsx"),
    source("src/app/(shop)/@modal/default.tsx"),
    source("src/components/layout/ModalShell.tsx"),
    source("src/app/(shop)/@modal/(.)auction/[id]/page.tsx"),
    source("src/app/(shop)/auction/[id]/page.tsx"),
    source("src/app/(shop)/@modal/(.)account/login/page.tsx"),
    source("src/app/(shop)/account/login/page.tsx"),
    source("src/app/(shop)/@modal/(.)auction/[id]/bid/page.tsx"),
    source("src/app/(shop)/auction/[id]/bid/page.tsx"),
    source("src/components/features/auction/detail/StickyBidPanel.tsx"),
    source("src/components/features/auction/AuctionFeedCard.tsx"),
    source("src/components/features/auction/AuctionCard.tsx"),
    source("src/components/features/auction/detail/AuctionDetailView.tsx"),
  ]);

  assert.match(shopLayout, /children: React\.ReactNode; modal: React\.ReactNode/);
  assert.match(shopLayout, /<PcLayout>\{children\}\{modal\}<\/PcLayout>/);
  assert.match(defaultModal, /return null/);
  assert.match(modalShell, /backdrop-blur-md/);
  assert.match(modalShell, /aria-modal="true"/);
  assert.match(modalShell, /event\.key === "Escape"/);
  assert.match(modalShell, /data-premium-modal-layer="nested"/);
  assert.match(modalShell, /ROUTE_MODAL_EXIT_MS/);
  assert.match(modalShell, /\(\) => router\.back\(\)/);
  assert.match(modalShell, /const releaseBodyScroll = lockBodyScroll\(\)/);
  assert.match(modalShell, /releaseBodyScroll\(\)/);
  assert.match(
    modalShell,
    /className="flex min-h-full[^\"]*" onMouseDown=\{\(event\) => event\.target === event\.currentTarget && close\(\)\}/,
  );
  assert.doesNotMatch(
    modalShell,
    /className="fixed inset-0[^\"]*" onMouseDown=/,
  );

  assert.match(interceptedProduct, /<ModalShell label="상품 상세" size="wide"><AuctionDetailView compact id=\{id\} \/><\/ModalShell>/);
  assert.match(detailView, /surface === "desktop" \? "grid-cols-12 gap-12" : "grid-cols-1"/);
  assert.match(detailView, /surface === "desktop" \? "col-span-7 min-w-0"/);
  assert.match(stickyBidPanel, /surface === "desktop"[\s\S]*sticky col-span-5/);
  assert.match(stickyBidPanel, /compact \? "top-6" : "top-\[100px\]"/);
  assert.match(directProduct, /<AuctionDetailView id=\{id\} \/>/);
  assert.match(interceptedLogin, /<ModalShell label="로그인"><LoginPrompt returnTo=\{safeReturnTo\(query\.next\)\} \/><\/ModalShell>/);
  assert.match(directLogin, /<LoginPrompt returnTo=\{safeReturnTo\(query\.next\)\} \/>/);
  for (const login of [interceptedLogin, directLogin]) {
    assert.match(login, /!candidate\.startsWith\("\/\/"\)/);
    assert.match(login, /!candidate\.startsWith\("\/api"\)/);
  }
  assert.match(interceptedBid, /<ModalShell label="실시간 경매 입찰"><AuctionBidRoute productId=\{id\} \/><\/ModalShell>/);
  assert.match(directBid, /<AuctionBidRoute productId=\{id\} \/>/);
  for (const biddingSurface of [stickyBidPanel, feedCard]) {
    assert.match(biddingSurface, /href=\{`\$\{basePath\}\/auction\/\$\{item\.id\}\/bid`\}/);
    assert.doesNotMatch(biddingSurface, /<BidModal/);
  }
  for (const fixedPurchaseSurface of [stickyBidPanel, auctionCard]) {
    assert.match(fixedPurchaseSurface, /router\.push\([\s\S]*?\$\{basePath\}\/account\/login\?next=/);
    assert.doesNotMatch(fixedPurchaseSurface, /window\.location\.assign\(/);
  }
});

test("gallery, Next Image, and supplied hero banners keep the V2 media contract", async () => {
  const [nextConfig, catalogImage, gallery, home, mobileBanner, wideBanner] = await Promise.all([
    source("next.config.ts"),
    source("src/components/ui/CatalogImage.tsx"),
    source("src/components/features/auction/AuctionGalleryModal.tsx"),
    source("src/app/(shop)/home/page.tsx"),
    stat(new URL("public/banners/brand-banner-mobile.jpg", rootUrl)),
    stat(new URL("public/banners/brand-banner-wide.png", rootUrl)),
  ]);

  assert.match(nextConfig, /formats:\s*\["image\/avif", "image\/webp"\]/);
  assert.match(nextConfig, /deviceSizes:\s*\[360, 480, 640, 768, 1024, 1280, 1536, 1920\]/);
  assert.match(nextConfig, /pathname:\s*"\/storage\/v1\/\*\*"/);
  assert.match(catalogImage, /import Image, \{ type ImageProps \} from "next\/image"/);
  assert.match(catalogImage, /blurDataURL = CATALOG_BLUR_DATA_URL/);
  assert.match(catalogImage, /placeholder = "blur"/);
  assert.match(catalogImage, /sizes = "\(max-width: 767px\) 50vw, \(max-width: 1023px\) 33vw, 20vw"/);

  assert.match(gallery, /useEmblaCarousel\(\{/);
  assert.match(gallery, /loop:\s*true/);
  assert.match(gallery, /emblaApi\?\.scrollPrev\(\)/);
  assert.match(gallery, /emblaApi\?\.scrollNext\(\)/);
  assert.match(gallery, /surface === "mobile" && <div aria-label="상품 사진 위치"/);
  assert.match(gallery, /surface === "desktop" && <nav aria-label="상품 사진 선택"/);

  const mobileHome = await source("src/app/(mobile)/m/home/page.tsx");
  assert.match(mobileHome, /src="\/banners\/brand-banner-mobile\.jpg"/);
  assert.match(home, /src="\/banners\/brand-banner-wide\.png"/);
  assert.ok(mobileBanner.isFile() && mobileBanner.size > 0);
  assert.ok(wideBanner.isFile() && wideBanner.size > 0);
});

test("the cache banner opts in only public assets and excludes private commerce documents", async () => {
  const [layout, banner, worker] = await Promise.all([
    source("src/components/layout/PcLayout.tsx"),
    source("src/components/layout/CacheConsentBanner.tsx"),
    source("public/sw.js"),
  ]);

  assert.match(layout, /<CacheConsentBanner surface="desktop" \/>/);
  assert.match(banner, /공개 상품·이미지·정적 리소스만 기기에 저장합니다/);
  assert.match(banner, /계정·주문·결제 정보는 저장하지 않습니다/);
  assert.match(banner, /writeCacheConsent\("accepted"\)/);
  assert.match(banner, /writeCacheConsent\("declined"\)/);
  assert.match(worker, /if \(request\.destination === "document"\) return false/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/products"\)/);
  assert.doesNotMatch(worker, /\/api\/(?:account|cart|orders|payments)/);
});
