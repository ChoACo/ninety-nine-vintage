"use client";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, Bell, Cog, Gavel, Heart, Home, Package, Store, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AccountDashboard } from "@/components/features/account/AccountDashboard";
import { BidHistory } from "@/components/features/account/BidHistory";
import { OrderHistory } from "@/components/features/account/OrderHistory";
import { MobilePwaControls } from "@/components/features/pwa/MobilePwaControls";
import { MyNotificationPreferences } from "@/components/features/mypage/MyNotificationPreferences";
import { NicknameSettings } from "@/components/account/NicknameSettings";
import { WishlistFeed } from "@/components/features/wishlist/WishlistFeed";
import { useAdminNavigationAccess } from "@/hooks/useAdminNavigationAccess";
import { getMobileRoleNavigation } from "@/lib/admin/mobileNavigation";
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
  const [tabPending, startTabTransition] = useTransition();
  const search = useSearchParams();
  const adminAccess = useAdminNavigationAccess();
  const roleNavigation = getMobileRoleNavigation(adminAccess.roleCode);
  const showOperatorShortcut =
    surface === "mobile" &&
    (adminAccess.roleCode === "operator" || adminAccess.roleCode === "owner");
  const requested = initialTab ?? search.get("tab");
  const active: MyTab = TABS.some((tab) => tab.id === requested)
    ? (requested as MyTab)
    : "home";
  const setTab = (tab: MyTab) => {
    let href: string;
    if (
      basePath === "" &&
      (tab === "home" || tab === "orders" || tab === "vault")
    ) {
      href = tab === "home" ? "/my" : `/my/${tab}`;
    } else {
      href = `${basePath}/my?tab=${tab}`;
    }
    window.dispatchEvent(new Event("ninety-nine:navigation-start"));
    startTabTransition(() => router.push(href, { scroll: false }));
  };
  return (
    <main className="space-y-6">
      <ProfileHeader
        activeTab={active}
        basePath={basePath}
        onTabChange={setTab}
      />
      {showOperatorShortcut ? (
        <Link
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 active:scale-[.98]"
          href={roleNavigation.centerHref}
          prefetch={false}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-paper">
            <Store aria-hidden="true" size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-black">판매센터 바로가기</strong>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {adminAccess.roleCode === "owner"
                ? "소유자 운영 화면으로 이동"
                : "상품·주문·출고 업무 화면으로 이동"}
            </span>
          </span>
          <ArrowUpRight aria-hidden="true" className="shrink-0" size={18} />
        </Link>
      ) : null}
      <nav
        aria-label="MY 대시보드 메뉴"
        className="flex snap-x gap-2 overflow-x-auto rounded-2xl border border-line bg-paper p-2"
      >
        {TABS.map(({ id, label, Icon }) => (
          <button
            aria-current={active === id ? "page" : undefined}
            className={`relative isolate flex min-h-11 shrink-0 items-center gap-2 overflow-hidden rounded-xl px-4 text-xs font-black ${active === id ? "text-paper" : "text-muted hover:bg-surface"}`}
            disabled={tabPending && active === id}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            {active === id && (
              <motion.span
                className="absolute inset-0 -z-10 rounded-xl bg-ink"
                layoutId={`my-tab-indicator-${basePath || "desktop"}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <Icon className="relative" size={15} />
            <span className="relative">{label}</span>
          </button>
        ))}
      </nav>
      <motion.section
        animate={{ opacity: 1 }}
        className="rounded-3xl border border-line bg-paper p-5 sm:p-7"
        initial={false}
        layout
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            initial={{ opacity: 0, x: 10 }}
            key={active}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
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
                <NicknameSettings presentation={surface === "mobile" ? "modal" : "inline"} />
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
          </motion.div>
        </AnimatePresence>
      </motion.section>
    </main>
  );
}
