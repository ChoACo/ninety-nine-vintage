import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const localTestRoot = path.join(tmpdir(), "ninety-nine-local-test-supabase");

const sourceSupabase = path.join(root, "supabase");
const sourceMigrations = path.join(sourceSupabase, "migrations");
const localSupabase = path.join(localTestRoot, "supabase");
const localMigrations = path.join(localSupabase, "migrations");
const supabase = process.platform === "win32" ? "supabase.exe" : "supabase";

const localTestAccountRoleMigration = `-- Generated only in the operating-system Temp workspace used by dev:local-test.
-- Browser test accounts are email/password users, so they do not have a real
-- Kakao identity. Treat only their immutable local_test_account metadata as
-- eligible for the repository's Kakao-role checks.
create or replace function public.auth_user_has_kakao_identity(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.identities as identities
    where identities.user_id = p_user_id
      and identities.provider = 'kakao'
  ) or exists (
    select 1
    from auth.users as users
    where users.id = p_user_id
      and users.raw_app_meta_data ->> 'local_test_account' = 'true'
  );
$$;

revoke all on function public.auth_user_has_kakao_identity(uuid) from public;

create or replace function public.route_backlog_after_operator_promotion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The browser button provisions its operator with a service-role request,
  -- not an owner session. There is no backlog to route in the isolated DB.
  if exists (
    select 1
    from auth.users as users
    where users.id = new.user_id
      and users.raw_app_meta_data ->> 'local_test_account' = 'true'
  ) then
    return new;
  end if;

  if new.role_code = 'operator'
    and (tg_op = 'INSERT' or old.role_code is distinct from new.role_code)
  then
    perform public.assign_unrouted_products_to_operator();
    perform public.assign_unrouted_support_conversations();
  end if;
  return new;
end;
$$;

revoke all on function public.route_backlog_after_operator_promotion() from public;

grant update on table public.account_access_roles to service_role;

-- Production keeps exactly one immutable Owner. The disposable local stack
-- additionally needs one deletable browser-test Owner alongside its required
-- fixture Owner, so relax only those two constraints here.
drop index if exists public.account_access_roles_single_owner_idx;

create or replace function public.protect_owner_access_role_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role_code = 'owner' and not exists (
    select 1
    from auth.users as users
    where users.id = old.user_id
      and users.raw_app_meta_data ->> 'local_test_account' = 'true'
  ) then
    raise exception using errcode = '42501', message = 'owner 역할 행은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_owner_access_role_delete() from public;

create or replace function public.protect_owner_auth_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.account_access_roles as roles
    where roles.user_id = old.id
      and roles.role_code = 'owner'
  ) and old.raw_app_meta_data ->> 'local_test_account' is distinct from 'true' then
    raise exception using errcode = '42501', message = '소유자 인증 계정은 삭제할 수 없습니다.';
  end if;
  return old;
end;
$$;

revoke all on function public.protect_owner_auth_delete() from public;

-- RLS policies alone do not grant Data API table privileges. Keep the
-- disposable local stack usable for the same member reads/writes exercised by
-- Kakao sessions in the application.
grant usage on schema public to authenticated;
grant select, insert, update on table public.store_memberships to service_role;
grant select on table public.fulfillment_center_staff_assignments to service_role;
grant update on table public.stores to service_role;
grant select, insert, update, delete on table
  public.cart_items,
  public.wishlist_items
to authenticated;
grant select on table
  public.commerce_orders,
  public.commerce_order_items,
  public.commerce_order_transfers,
  public.shipping_credit_ledger,
  public.shipping_fee_payments,
  public.notifications,
  public.stores
to authenticated;

-- Give the disposable checkout flow a clearly fake, valid-format destination
-- so member cart reads do not fail before any payment test begins.
update public.payment_runtime_settings
set
  active_mode = 'manual_transfer',
  bank_name = '로컬 테스트 은행',
  account_number = '000-0000-0000'
where singleton;

create or replace function public.attach_local_test_account_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_app_meta_data ->> 'local_test_account' = 'true' then
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      new.id::text,
      new.id,
      jsonb_build_object('sub', new.id::text, 'email', new.email::text),
      'kakao', clock_timestamp(), clock_timestamp(), clock_timestamp()
    ) on conflict (provider_id, provider) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.attach_local_test_account_identity() from public;

drop trigger if exists auth_users_attach_local_test_identity on auth.users;
create trigger auth_users_attach_local_test_identity
after insert on auth.users
for each row execute function public.attach_local_test_account_identity();
`;

export async function prepareLocalTestSupabase() {
  // This fixed Temp folder contains only generated local-test files.
  await rm(localTestRoot, { recursive: true, force: true });
  await mkdir(localMigrations, { recursive: true });
  await cp(sourceMigrations, localMigrations, { recursive: true });

  const config = await readFile(path.join(sourceSupabase, "config.toml"), "utf8");
  const localConfig = config
    .replace(
      /^project_id\s*=\s*"[^"]+"/mu,
      'project_id = "ninety-nine-local-test"',
    )
    .replace(
      /(\[auth\.email\][\s\S]*?^enable_signup\s*=\s*)false/mu,
      "$1true",
    );
  await writeFile(path.join(localSupabase, "config.toml"), localConfig);

  await cp(
    path.join(root, "tests", "integration", "unified-inventory-fulfillment-v2-bootstrap.sql"),
    path.join(localMigrations, "20260718025000_test_seed_required_owner_identity.sql"),
  );
  await cp(
    path.join(root, "tests", "integration", "unified-inventory-fulfillment-v2-second-operator.sql"),
    path.join(localMigrations, "20260718055000_test_promote_required_second_operator.sql"),
  );
  await writeFile(
    path.join(localMigrations, "20260724000000_allow_local_test_account_roles.sql"),
    localTestAccountRoleMigration,
  );
}

export function runLocalSupabase(args, { capture = false } = {}) {
  const result = spawnSync(supabase, [...args, "--workdir", localTestRoot], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`Supabase exited with ${result.status}.`);
  }
  return result.stdout ?? "";
}

export function readLocalSupabaseEnvironment() {
  const values = new Map();
  for (const line of runLocalSupabase(["status", "-o", "env"], { capture: true }).split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim().replace(/^"|"$/gu, ""),
    );
  }

  const apiUrl = values.get("API_URL");
  const anonKey = values.get("ANON_KEY");
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY");
  if (!apiUrl || !anonKey || !serviceRoleKey) {
    throw new Error("The local Supabase API keys could not be read.");
  }
  return { apiUrl, anonKey, serviceRoleKey };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command !== "reset") {
    throw new Error("Usage: node scripts/local-test-supabase.mjs reset");
  }
  await prepareLocalTestSupabase();
  runLocalSupabase(["start"]);
  runLocalSupabase(["db", "reset", "--local"]);
}
