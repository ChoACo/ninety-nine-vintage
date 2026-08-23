import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the storefront renders separate mobile and fluid desktop presentation trees", async () => {
  const [home, mobileHome, layout, mobileLayout, mobileAutoHideHeader, header, productRail, centerMall, centerSkeletons, css] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/app/(mobile)/m/home/page.tsx"),
    source("src/components/layout/PcLayout.tsx"),
    source("src/components/mobile/MobileSiteLayout.tsx"),
    source("src/components/mobile/MobileAutoHideHeader.tsx"),
    source("src/components/layout/PcHeader.tsx"),
    source("src/components/features/catalog/ProductRail.tsx"),
    source("src/components/features/catalog/CenterMallHub.tsx"),
    source("src/components/features/catalog/CenterSkeletons.tsx"),
    source("src/app/globals.css"),
  ]);

  assert.match(home, /function DesktopHome\(/);
  assert.doesNotMatch(home, /MobileHome|md:hidden|data-home-presentation="mobile"/);
  assert.match(home, /<DesktopHome auctions=\{auctions\.slice\(0, 6\)\}/);
  assert.match(
    home,
    /<HomeFeaturedAuction banners=\{config\.banners\} products=\{featuredAuctions\} \/>/,
  );
  assert.match(mobileHome, /data-mobile-home/);
  assert.match(mobileHome, /basePath="\/m"/);
  assert.match(layout, /data-global-sticky-header/);
  assert.match(layout, /<PcHeader \/>/);
  assert.match(layout, /data-ui-surface="desktop"/);
  assert.match(layout, /max-w-\[1600px\]/);
  assert.match(layout, /data-desktop-canvas="fluid"/);
  assert.match(layout, /max-w-\[1400px\]/);
  assert.match(layout, /data-desktop-content="fluid"/);
  assert.doesNotMatch(layout, /MobileHeader|MobileBottomNav|md:hidden/);
  assert.match(header, /max-w-\[1400px\]/);
  assert.match(header, /form className="hidden h-10 w-32[^"]*min-\[900px\]:flex lg:w-36 xl:w-44/);
  assert.match(header, /(?:sm|md|lg|xl):/);
  assert.match(productRail, /surface === "desktop"\s*\? "grid grid-cols-3 gap-2"/);
  assert.match(productRail, /grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/);
  assert.match(productRail, /grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-3 md:gap-6 lg:grid-cols-4/);
  assert.match(centerMall, /grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4/);
  assert.match(centerMall, /aspect-\[16\/10\]/);
  assert.match(centerSkeletons, /grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4/);
  assert.match(home, /text-\[clamp\(2rem,5vw,3\.5rem\)\]/);
  assert.match(home, /text-balance/);
  assert.match(home, /"only screen and \(max-width: 1279px\)": "\/m\/home"/);
  assert.match(css, /\[data-ui-surface="desktop"\][\s\S]*word-break: keep-all/);
  assert.match(mobileLayout, /data-ui-surface="mobile"/);
  assert.match(mobileLayout, /<MobileAutoHideHeader>/);
  assert.match(mobileAutoHideHeader, /data-global-sticky-header/);
  assert.match(mobileLayout, /<MobileSiteHeader \/>/);
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
  assert.match(detailView, /grid w-full max-w-\[1400px\] grid-cols-1 items-start gap-6 p-0 sm:grid-cols-12/);
  assert.match(detailView, /min-w-0[\s\S]*sm:col-span-6/);
  assert.match(stickyBidPanel, /sm:sticky sm:col-span-6/);
  assert.match(stickyBidPanel, /compact \? "sm:top-6" : "sm:top-20 md:top-24"/);
  assert.match(directProduct, /<AuctionDetailView id=\{id\} \/>/);
  assert.match(interceptedLogin, /<ModalShell label="로그인"><LoginPrompt dismissToPrevious returnTo=\{safeReturnTo\(query\.next\)\} \/><\/ModalShell>/);
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
  const [nextConfig, catalogImage, gallery, featuredAuction, ...optimizedBanners] = await Promise.all([
    source("next.config.ts"),
    source("src/components/ui/CatalogImage.tsx"),
    source("src/components/features/auction/AuctionGalleryModal.tsx"),
    source("src/components/features/home/HomeFeaturedAuction.tsx"),
    ...[
      "brand-banner-mobile-480.webp",
      "brand-banner-mobile-768.webp",
      "brand-banner-mobile-1080.webp",
      "brand-banner-wide-640.webp",
      "brand-banner-wide-960.webp",
      "brand-banner-wide-1440.webp",
    ].map((name) => stat(new URL(`public/banners/v1/${name}`, rootUrl))),
  ]);

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
  assert.match(mobileHome, /<HomeFeaturedAuction/);
  assert.match(mobileHome, /surface="mobile"/);
  assert.match(featuredAuction, /\/banners\/v1\/brand-banner-mobile-1080\.webp/);
  assert.match(featuredAuction, /\/banners\/v1\/brand-banner-wide-1440\.webp/);
  assert.match(featuredAuction, /object-contain object-center/);
  assert.match(featuredAuction, /fetchPriority="high"/);
  assert.match(featuredAuction, /import Image from "next\/image"/);
  assert.match(featuredAuction, /placeholder="blur"/);
  assert.match(featuredAuction, /sizes=\{fallbackBanner\.sizes\}/);
   assert.ok(optimizedBanners.every((banner) => banner.isFile() && banner.size > 0));
  assert.ok(optimizedBanners.every((banner) => banner.size < 30_000));
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
  assert.match(banner, /현재 상태:/);
  assert.match(banner, /캐시 사용/);
  assert.match(banner, /사용 안 함/);
  assert.match(banner, /저장 캐시 비우기/);
  assert.match(banner, /await clearPublicCache\(\)/);
  assert.match(worker, /if \(request\.destination === "document"\) return false/);
  assert.match(worker, /\["localhost", "127\.0\.0\.1", "::1"\]\.includes\(url\.hostname\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/products"\)/);
  assert.doesNotMatch(worker, /\/api\/(?:account|cart|orders|payments)/);
});
