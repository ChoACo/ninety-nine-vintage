import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("the storefront renders separate mobile and desktop presentation trees", async () => {
  const [home, layout] = await Promise.all([
    source("src/app/(shop)/home/page.tsx"),
    source("src/components/layout/PcLayout.tsx"),
  ]);

  assert.match(home, /function MobileHome\(/);
  assert.match(home, /className="block space-y-12 md:hidden"/);
  assert.match(home, /function DesktopHome\(/);
  assert.match(home, /className="hidden space-y-16 md:block"/);
  assert.match(home, /<MobileHome auctions=\{auctions\}[\s\S]*?<DesktopHome auctions=\{auctions\}/);
  assert.match(layout, /<PcHeader hasLiveTicker=\{LIVE_AUCTION_ENABLED\} \/>/);
  assert.match(layout, /<MobileHeader hasLiveTicker=\{LIVE_AUCTION_ENABLED\} \/>/);
  assert.match(layout, /className="hidden md:block"><PcFooter \/>/);
  assert.match(layout, /<MobileBottomNav \/>/);
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
  ]);

  assert.match(shopLayout, /children: React\.ReactNode; modal: React\.ReactNode/);
  assert.match(shopLayout, /<PcLayout>\{children\}\{modal\}<\/PcLayout>/);
  assert.match(defaultModal, /return null/);
  assert.match(modalShell, /backdrop-blur-md/);
  assert.match(modalShell, /aria-modal="true"/);
  assert.match(modalShell, /event\.key === "Escape"\) router\.back\(\)/);
  assert.match(modalShell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(modalShell, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(
    modalShell,
    /className="flex min-h-full[^\"]*" onMouseDown=\{\(event\) => event\.target === event\.currentTarget && router\.back\(\)\}/,
  );
  assert.doesNotMatch(
    modalShell,
    /className="fixed inset-0[^\"]*" onMouseDown=/,
  );

  assert.match(interceptedProduct, /<ModalShell label="상품 상세"><AuctionDetailView compact id=\{id\} \/><\/ModalShell>/);
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
    assert.match(biddingSurface, /href=\{`\/auction\/\$\{item\.id\}\/bid`\}/);
    assert.doesNotMatch(biddingSurface, /<BidModal/);
  }
  for (const fixedPurchaseSurface of [stickyBidPanel, auctionCard]) {
    assert.match(fixedPurchaseSurface, /router\.push\(\s*`\/account\/login\?next=/);
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
  assert.match(
    gallery,
    /className="flex min-h-12[^"]*pb-\[env\(safe-area-inset-bottom\)\][^"]*md:hidden"/,
  );
  assert.match(gallery, /className="hidden h-24[^"]*md:flex"/);

  assert.match(home, /src="\/banners\/brand-banner-mobile\.jpg"/);
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

  assert.match(layout, /<CacheConsentBanner \/>/);
  assert.match(banner, /공개 상품·이미지·정적 리소스만 기기에 저장합니다/);
  assert.match(banner, /계정·주문·결제 정보는 저장하지 않습니다/);
  assert.match(banner, /writeCacheConsent\("accepted"\)/);
  assert.match(banner, /writeCacheConsent\("declined"\)/);
  assert.match(worker, /if \(request\.destination === "document"\) return false/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/products"\)/);
  assert.doesNotMatch(worker, /\/api\/(?:account|cart|orders|payments)/);
});
