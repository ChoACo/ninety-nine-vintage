"use client";
import { Bell, Cog, Gavel, Heart, Home, Package, Truck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { MyNotificationPreferences } from "@/components/features/mypage/MyNotificationPreferences";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { WishlistFeed } from "@/components/features/wishlist/WishlistFeed";
import {
  ProfileHeader,
  type MyTab,
} from "@/components/features/mypage/ProfileHeader";
const TABS = [
  { id: "home" as const, label: "홈", Icon: Home },
  { id: "vault" as const, label: "보관함", Icon: Package },
  { id: "auction" as const, label: "옥션·결제", Icon: Gavel },
  { id: "orders" as const, label: "주문·배송", Icon: Truck },
  { id: "wishlist" as const, label: "찜", Icon: Heart },
  { id: "settings" as const, label: "계정 설정", Icon: Cog },
];
export function MyDashboard({
  basePath = "",
  initialTab,
  surface = "desktop",
}: {
  basePath?: "" | "/m";
  initialTab?: MyTab;
  surface?: "desktop" | "mobile";
}) {
  const router = useRouter();
  const search = useSearchParams();
  const requested = initialTab ?? search.get("tab");
  const active: MyTab = TABS.some((tab) => tab.id === requested)
    ? (requested as MyTab)
    : "home";
  const setTab = (tab: MyTab) => {
    if (
      basePath === "" &&
      (tab === "home" || tab === "orders" || tab === "vault")
    ) {
      router.push(tab === "home" ? "/my" : `/my/${tab}`);
      return;
    }
    router.push(`${basePath}/my?tab=${tab}`);
  };
  return (
    <main className="space-y-6">
      <ProfileHeader
        activeTab={active}
        basePath={basePath}
        onTabChange={setTab}
      />
      <nav
        aria-label="MY 대시보드 메뉴"
        className="flex snap-x gap-2 overflow-x-auto rounded-2xl border border-line bg-paper p-2"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            aria-current={active === id ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-black ${active === id ? "bg-ink text-paper" : "text-muted hover:bg-surface"}`}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </nav>
      <section className="rounded-3xl border border-line bg-paper p-5 sm:p-7">
        {active === "home" ? (
          <div className="space-y-10">
            <AccountDashboard
              homeOnly
              onNavigate={(view) =>
                setTab(
                  view === "storage"
                    ? "vault"
                    : view === "shipping"
                      ? "orders"
                      : "auction",
                )
              }
              surface={surface}
              view="overview"
            />
            <section>
              <h2 className="text-xl font-black">기본 배송지</h2>
              <div className="mt-4">
                <AccountDashboard
                  basePath={basePath}
                  surface={surface}
                  view="addresses"
                />
              </div>
            </section>
            <section>
              <h2 className="text-xl font-black">라이브 옥션 참여·낙찰</h2>
              <div className="mt-4">
                <BidHistory basePath={basePath} surface={surface} />
              </div>
            </section>
            <section>
              <h2 className="inline-flex items-center gap-2 text-xl font-black">
                <Bell size={18} />
                카카오·서비스 알림 설정
              </h2>
              <div className="mt-4">
                <MyNotificationPreferences />
                <MobilePwaControls />
              </div>
            </section>
          </div>
        ) : active === "vault" ? (
          <>
            <div className="mb-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
              <h2 className="font-black">
                최대 14일 무료 보관 · 원하는 상품을 한 번에
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                센터별 보관 상품을 선택해 묶음 배송을 신청할 수 있습니다.
              </p>
            </div>
            <AccountDashboard
              basePath={basePath}
              surface={surface}
              view="storage"
            />
          </>
        ) : active === "auction" ? (
          <div className="space-y-10">
            <BidHistory basePath={basePath} surface={surface} />
            <AccountDashboard
              basePath={basePath}
              surface={surface}
              view="payments"
            />
          </div>
        ) : active === "orders" ? (
          <OrderHistory basePath={basePath} surface={surface} />
        ) : active === "wishlist" ? (
          <WishlistFeed basePath={basePath} />
        ) : (
          <div className="space-y-10">
            <section>
              <h2 className="text-xl font-black">프로필·닉네임</h2>
              <div className="mt-4">
                <NicknameSettings />
              </div>
            </section>
            <section>
              <h2 className="inline-flex items-center gap-2 text-xl font-black">
                <Bell size={18} />
                알림 설정
              </h2>
              <div className="mt-4">
                <MyNotificationPreferences />
                <MobilePwaControls />
              </div>
            </section>
            <AccountDashboard
              basePath={basePath}
              surface={surface}
              view="addresses"
            />
          </div>
        )}
      </section>
    </main>
  );
}
