import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("local test accounts stay dormant unless the isolated local-test launcher explicitly enables them", async () => {
  const [config, route, actions, switcher, localDatabase, launcher, envExample, auth, login] = await Promise.all([
    source("src/lib/localTestAccounts/config.ts"),
    source("src/app/api/local-test-accounts/route.ts"),
    source("src/components/features/account/LocalTestAccountActions.tsx"),
    source("src/components/admin/LocalTestMemberSwitcher.tsx"),
    source("scripts/local-test-supabase.mjs"),
    source("scripts/start-local-test-app.mjs"),
    source(".env.example"),
    source("src/lib/supabase/auth.ts"),
    source("src/components/features/account/LoginPrompt.tsx"),
  ]);

  assert.match(config, /LOCAL_TEST_ACCOUNTS_ENABLED/);
  assert.match(config, /=== "true"/);
  assert.match(config, /process\.env\.NODE_ENV !== "development"/);
  assert.match(config, /LOCAL_HOSTS/);
  assert.match(config, /LOCAL_TEST_ACCOUNT_PASSWORD/);
  assert.match(launcher, /LOCAL_TEST_ACCOUNTS_ENABLED: "true"/);
  assert.match(envExample, /LOCAL_TEST_ACCOUNTS_ENABLED=false/);
  assert.match(route, /canUseLocalTestAccounts\(\)/);
  assert.match(route, /local_test_account: true/);
  assert.match(route, /account_access_roles/);
  assert.match(route, /member-primary/);
  assert.match(route, /operator-primary/);
  assert.match(route, /operator-secondary/);
  assert.match(route, /local\.operator\.admin-2@ninety-nine\.test/);
  assert.match(route, /RETIRED_TEST_ACCOUNT_EMAILS/);
  assert.match(route, /local\.member\.admin-2@ninety-nine\.test/);
  assert.match(route, /local\.owner@ninety-nine\.test/);
  assert.match(route, /role: "owner"/);
  assert.match(route, /local_test_account_slot/);
  assert.match(route, /signInWithPassword/);
  assert.match(route, /\.from\("store_memberships"\)[\s\S]*membership_role: "operator"/);
  assert.match(route, /\.update\(\{ operator_id: user\.id \}\)/);
  assert.match(route, /\.update\(\{ operator_id: owner\.user_id \}\)/);
  assert.match(route, /!localTestUserIds\.has\(candidate\.user_id\)/);
  assert.match(route, /manage_products: true/);
  assert.match(route, /publish_products: true/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /admin\.auth\.admin\.deleteUser/);
  assert.match(actions, /테스트 회원으로 접속/);
  assert.doesNotMatch(actions, /member-secondary/);
  assert.match(actions, /테스트 운영자 ID 1로 접속/);
  assert.match(actions, /테스트 운영자 ID 2로 접속/);
  assert.match(actions, /테스트 관리자로 접속/);
  assert.match(actions, /window\.location\.assign\(returnTo\)/);
  assert.doesNotMatch(actions, /destination|\/admin\/owner|\/admin\/operator/);
  assert.match(actions, /로컬 테스트 계정 모두 삭제/);
  assert.match(actions, /db:reset-local/);
  assert.match(switcher, /테스트 회원 접속/);
  assert.match(switcher, /member-primary/);
  assert.doesNotMatch(switcher, /member-secondary/);
  assert.match(switcher, /테스트 회원 삭제/);
  assert.match(localDatabase, /attach_local_test_account_identity/);
  assert.match(localDatabase, /provider,\s*last_sign_in_at[\s\S]*'kakao'/);
  assert.match(localDatabase, /grant select, insert, update, delete on table[\s\S]*public\.wishlist_items[\s\S]*to authenticated/);
  assert.match(localDatabase, /grant select on table[\s\S]*public\.commerce_orders[\s\S]*public\.stores[\s\S]*to authenticated/);
  assert.match(localDatabase, /grant select, insert, update on table public\.store_memberships to service_role/);
  assert.match(localDatabase, /grant select on table public\.fulfillment_center_staff_assignments to service_role/);
  assert.match(localDatabase, /grant update on table public\.stores to service_role/);
  assert.match(localDatabase, /drop index if exists public\.account_access_roles_single_owner_idx/);
  assert.match(localDatabase, /create or replace function public\.protect_owner_access_role_delete/);
  assert.match(localDatabase, /create or replace function public\.protect_owner_auth_delete/);
  assert.match(localDatabase, /old\.raw_app_meta_data ->> 'local_test_account'/);
  assert.match(localDatabase, /bank_name = '로컬 테스트 은행'/);
  assert.match(localDatabase, /account_number = '000-0000-0000'/);
  assert.match(auth, /local_test_account === true/);
  assert.match(login, /canUseLocalTestAccounts\(\)/);
});
