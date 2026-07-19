import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("owner route hides unauthorized users behind the route not-found boundary", async () => {
  const [page, route, notFoundPage] = await Promise.all([
    source("src/components/owner/OwnerPrivatePage.tsx"),
    source("src/app/owner/page.tsx"),
    source("src/app/owner/not-found.tsx"),
  ]);

  assert.match(page, /!auth\.user \|\| !auth\.session \|\| !isOwnerRole\(auth\.role\)/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /if \(auth\.isLoading\) return <OwnerGateState/);
  assert.match(
    page,
    /if \(!auth\.isLoading && auth\.user && auth\.session && isOwnerRole\(auth\.role\)\) \{\s*document\.title = "Control Plane \| NINETY-NINE VINTAGE"/,
  );
  assert.doesNotMatch(page, /등록된 운영 총책임자 계정|이 도구는/);
  assert.match(route, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.doesNotMatch(route, /운영 보안 메뉴|총책임자/);
  assert.match(notFoundPage, /404 · NOT FOUND/);
  assert.doesNotMatch(notFoundPage, /관리자|총책임자|운영 보안|MASTER CONTROL/i);
});

test("owner console renders four accessible lazy workspace modules", async () => {
  const page = await source("src/components/owner/OwnerPrivatePage.tsx");

  for (const id of ["security", "sandbox", "rbac", "emergency"]) {
    assert.match(page, new RegExp(`id: "${id}"`));
    assert.match(page, new RegExp(`owner-panel-\\$\\{workspace\\.id\\}`));
  }
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /aria-selected=\{isActive\}/);
  assert.match(page, /visitedWorkspaces\.has\(workspace\.id\)/);
  assert.match(page, /ArrowDown/);
  assert.match(page, /ArrowRight/);
  assert.match(page, /Home/);
  assert.match(page, /End/);
  assert.match(page, /lg:grid-cols-\[248px_minmax\(0,1fr\)\]/);
  assert.match(page, /overflow-x-auto/);

  assert.match(page, /<OwnerDelegationPanel accessToken=\{accessToken\}/);
  assert.match(page, /<OwnerHiddenTestPanel accessToken=\{accessToken\}/);
  assert.match(page, /<OwnerAuctionControlPanel/);
  assert.match(page, /<StaffChatInbox staffId=\{ownerUserId\} role="admin"/);
});

test("security workbench uses dataset tabs without changing audited handlers", async () => {
  const panel = await source("src/components/owner/OwnerSecurityAdminPanel.tsx");

  for (const id of ["activity", "requests", "sessions", "blocks", "support"]) {
    assert.match(panel, new RegExp(`id: "${id}"`));
  }
  assert.match(panel, /visitedWorkspaces/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /listOwnerSecurityActivity/);
  assert.match(panel, /listOwnerSecurityLogRequests/);
  assert.match(panel, /listOwnerSecuritySessions/);
  assert.match(panel, /createOwnerIpBlockRule/);
  assert.match(panel, /updateOwnerIpBlockRule/);
  assert.match(panel, /changeReason: editor\.changeReason\.trim\(\)/);
  assert.doesNotMatch(panel, /window\.confirm/);
  assert.match(panel, /<OwnerDangerConfirmModal/);
});

test("RBAC engine exposes four assignable roles and immutable authorization history", async () => {
  const rbac = await source("src/components/owner/OwnerRbacPanel.tsx");

  assert.match(rbac, /grade: "0"/);
  assert.match(rbac, /grade: "1"/);
  assert.match(rbac, /grade: "2"/);
  assert.match(rbac, /grade: "2\.5"/);
  assert.match(rbac, /grade: "3"/);
  assert.match(rbac, /getStaffMemberDirectory/);
  assert.match(rbac, /setMemberAccessRole\(member\.id, role\)/);
  assert.match(rbac, /category: "authorization"/);
  assert.match(rbac, /listOwnerSecurityActivity/);
  assert.match(rbac, /previous_role/);
  assert.match(rbac, /item\.metadata\.role/);
  assert.doesNotMatch(rbac, /<option[^>]+value="owner"/);
  assert.match(rbac, /font-mono/);
  assert.match(rbac, /tabular-nums/);
  assert.match(rbac, /<OwnerDangerConfirmModal/);
});

test("emergency zone changes only supported payment runtime and refuses fake controls", async () => {
  const [panel, route, client] = await Promise.all([
    source("src/components/owner/OwnerEmergencyControlPanel.tsx"),
    source("src/app/api/owner/payment-mode/route.ts"),
    source("src/lib/ownerAccess/client.ts"),
  ]);

  assert.match(route, /authenticateOwnerAccessRequest\(request\)/);
  assert.match(route, /set_payment_runtime_mode/);
  assert.match(route, /get_manual_transfer_settings/);
  assert.match(route, /PORTONE_API_SECRET/);
  assert.match(route, /getPortOneWebhookSecret/);
  assert.match(route, /portone_not_ready/);
  assert.match(client, /\/api\/owner\/payment-mode/);
  assert.match(panel, /BACKEND LOCKED/);
  assert.match(panel, /전체 경매 수동 일시정지/);
  assert.match(panel, /NO-STORE/);
  assert.doesNotMatch(panel, /fetch\([^)]*cache\/clear|\/api\/owner\/auction\/pause/);
  assert.match(panel, /<OwnerDangerConfirmModal/);
});

test("owner auction and network mutations use the premium danger dialog", async () => {
  const [auction, security, modal] = await Promise.all([
    source("src/components/owner/OwnerAuctionControlPanel.tsx"),
    source("src/components/owner/OwnerSecurityAdminPanel.tsx"),
    source("src/components/owner/OwnerDangerConfirmModal.tsx"),
  ]);

  assert.match(auction, /ownerCloseAuctionNow/);
  assert.match(auction, /ownerOverrideAuctionPrice/);
  assert.doesNotMatch(auction, /window\.confirm/);
  assert.doesNotMatch(security, /window\.confirm/);
  assert.match(modal, /role="alertdialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /bg-black\/75/);
});
