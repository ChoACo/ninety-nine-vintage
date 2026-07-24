import { hasTrustedRequestOrigin } from "@/lib/kakao/oidc";
import {
  canUseLocalTestAccounts,
  getLocalTestAccountPassword,
} from "@/lib/localTestAccounts/config";
import {
  createSupabasePublicClient,
  createSupabaseServerClients,
} from "@/lib/supabase/server";

type LocalTestRole = "member" | "operator" | "owner";
type LocalTestAccountSlot =
  | "member-primary"
  | "operator-primary"
  | "operator-secondary"
  | "owner";

const TEST_ACCOUNTS: Record<
  LocalTestAccountSlot,
  { displayName: string; email: string; role: LocalTestRole }
> = {
  "member-primary": {
    displayName: "로컬 테스트 회원",
    email: "local.member.admin-1@ninety-nine.test",
    role: "member",
  },
  "operator-primary": {
    displayName: "로컬 테스트 운영자 ID 1",
    email: "local.operator@ninety-nine.test",
    role: "operator",
  },
  "operator-secondary": {
    displayName: "로컬 테스트 운영자 ID 2",
    email: "local.operator.admin-2@ninety-nine.test",
    role: "operator",
  },
  owner: {
    displayName: "로컬 테스트 관리자",
    email: "local.owner@ninety-nine.test",
    role: "owner",
  },
};

const RETIRED_TEST_ACCOUNT_EMAILS = new Set([
  "local.member.admin-2@ninety-nine.test",
]);

const OPERATOR_TEST_ACCOUNT_EMAILS = new Set(
  Object.values(TEST_ACCOUNTS)
    .filter((account) => account.role === "operator")
    .map((account) => account.email),
);

function disabledResponse() {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isCurrentLocalTestAccount(
  user: { app_metadata?: Record<string, unknown>; email?: string | null },
) {
  return user.app_metadata?.local_test_account === true &&
    Object.values(TEST_ACCOUNTS).some((account) => account.email === user.email);
}

function isManagedLocalTestAccount(
  user: { app_metadata?: Record<string, unknown>; email?: string | null },
) {
  return isCurrentLocalTestAccount(user) ||
    (
      user.app_metadata?.local_test_account === true &&
      typeof user.email === "string" &&
      RETIRED_TEST_ACCOUNT_EMAILS.has(user.email)
    );
}

function readAccountSlot(value: unknown): LocalTestAccountSlot | null {
  if (
    value === "member-primary" ||
    value === "operator-primary" ||
    value === "operator-secondary" ||
    value === "owner"
  ) {
    return value;
  }
  // Keep the original login button contracts compatible.
  if (value === "member") return "member-primary";
  if (value === "operator") return "operator-primary";
  return null;
}

async function findTestAccount(
  email: string,
  users: { app_metadata?: Record<string, unknown>; email?: string | null; id: string }[],
) {
  return users.find((user) => user.email === email) ?? null;
}

export async function GET() {
  if (!canUseLocalTestAccounts()) return disabledResponse();

  try {
    const { admin } = createSupabaseServerClients();
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) return response({ error: "account_lookup_failed" }, 503);

    return response({
      accounts: Object.entries(TEST_ACCOUNTS).map(([slot, account]) => ({
        created: listed.data.users.some(
          (user) =>
            user.email === account.email && isCurrentLocalTestAccount(user),
        ),
        displayName: account.displayName,
        role: account.role,
        slot,
      })),
    });
  } catch {
    return response({ error: "account_lookup_failed" }, 503);
  }
}

export async function POST(request: Request) {
  if (!canUseLocalTestAccounts()) return disabledResponse();
  if (!hasTrustedRequestOrigin(request)) {
    return response({ error: "forbidden" }, 403);
  }

  let slot: LocalTestAccountSlot;
  try {
    const body = await request.json() as { role?: unknown; slot?: unknown };
    const requestedSlot = readAccountSlot(body.slot ?? body.role);
    if (!requestedSlot) {
      return response({ error: "invalid_role" }, 400);
    }
    slot = requestedSlot;
  } catch {
    return response({ error: "invalid_request" }, 400);
  }

  const account = TEST_ACCOUNTS[slot];
  const role = account.role;
  const password = getLocalTestAccountPassword();
  if (!password) return disabledResponse();

  try {
    const { admin } = createSupabaseServerClients();
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) return response({ error: "account_lookup_failed" }, 503);

    let user = await findTestAccount(account.email, listed.data.users);
    let created = false;
    if (user && !isCurrentLocalTestAccount(user)) {
      return response({ error: "reserved_email_in_use" }, 409);
    }

    if (!user) {
      const createdUser = await admin.auth.admin.createUser({
        app_metadata: { local_test_account: true, local_test_account_slot: slot, role },
        email: account.email,
        email_confirm: true,
        password,
        user_metadata: { display_name: account.displayName },
      });
      if (createdUser.error || !createdUser.data.user) {
        return response({ error: "account_create_failed" }, 503);
      }
      user = createdUser.data.user;
      created = true;
    }

    const { error: roleError } = await admin
      .from("account_access_roles")
      .upsert({ role_code: role, user_id: user.id }, { onConflict: "user_id" });
    if (roleError) {
      if (created) await admin.auth.admin.deleteUser(user.id);
      return response({ error: "role_setup_failed" }, 503);
    }

    if (role === "operator") {
      const { data: operatorStores, error: storeError } = await admin
        .from("stores")
        .select("id, business_id")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      const storeIndex = slot === "operator-secondary" ? 1 : 0;
      const store = operatorStores?.[storeIndex] ?? null;
      if (storeError || !store) {
        if (created) await admin.auth.admin.deleteUser(user.id);
        return response({ error: "operator_store_setup_failed" }, 503);
      }
      const { error: storeAssignmentError } = await admin
        .from("stores")
        .update({ operator_id: user.id })
        .eq("id", store.id);
      if (storeAssignmentError) {
        if (created) await admin.auth.admin.deleteUser(user.id);
        return response({ error: "operator_store_setup_failed" }, 503);
      }
      const { error: membershipError } = await admin
        .from("store_memberships")
        .upsert({
          business_id: store.business_id,
          confirm_payments: true,
          create_shipments: true,
          manage_products: true,
          manage_staff: true,
          membership_role: "operator",
          prepare_orders: true,
          publish_products: true,
          status: "active",
          store_id: store.id,
          user_id: user.id,
          view_reports: true,
        }, { onConflict: "store_id,user_id" });
      if (membershipError) {
        if (created) await admin.auth.admin.deleteUser(user.id);
        return response({ error: "operator_store_setup_failed" }, 503);
      }
    }

    // Keep the button idempotent even when the local .env password changes
    // between test runs. This is reachable only against a localhost stack.
    const refreshedUser = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { local_test_account: true, local_test_account_slot: slot, role },
      password,
    });
    if (refreshedUser.error) {
      return response({ error: "account_refresh_failed" }, 503);
    }

    const signedIn = await createSupabasePublicClient().auth.signInWithPassword({
      email: account.email,
      password,
    });
    if (signedIn.error || !signedIn.data.session) {
      return response({ error: "session_create_failed" }, 503);
    }

    return response({
      created,
      role,
      slot,
      session: {
        accessToken: signedIn.data.session.access_token,
        refreshToken: signedIn.data.session.refresh_token,
      },
    });
  } catch {
    return response({ error: "local_test_account_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!canUseLocalTestAccounts()) return disabledResponse();
  if (!hasTrustedRequestOrigin(request)) {
    return response({ error: "forbidden" }, 403);
  }

  try {
    const body = await request.json().catch(() => null) as {
      slot?: unknown;
    } | null;
    const requestedSlot = body?.slot === undefined
      ? null
      : readAccountSlot(body.slot);
    if (body?.slot !== undefined && !requestedSlot) {
      return response({ error: "invalid_role" }, 400);
    }

    const { admin } = createSupabaseServerClients();
    const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listed.error) return response({ error: "account_lookup_failed" }, 503);

    const targetEmail = requestedSlot
      ? TEST_ACCOUNTS[requestedSlot].email
      : null;
    const targets = listed.data.users.filter(
      (user) =>
        isManagedLocalTestAccount(user) &&
        (targetEmail === null || user.email === targetEmail),
    );
    const localTestUserIds = new Set(
      listed.data.users.filter(isManagedLocalTestAccount).map((user) => user.id),
    );
    for (const user of targets) {
      if (
        typeof user.email === "string" &&
        OPERATOR_TEST_ACCOUNT_EMAILS.has(user.email)
      ) {
        const { data: owners, error: ownerError } = await admin
          .from("account_access_roles")
          .select("user_id")
          .eq("role_code", "owner");
        const owner = owners?.find(
          (candidate) => !localTestUserIds.has(candidate.user_id),
        );
        if (ownerError || !owner) {
          return response({ error: "account_cleanup_failed" }, 503);
        }
        const { error: restoreStoreError } = await admin
          .from("stores")
          .update({ operator_id: owner.user_id })
          .eq("operator_id", user.id);
        if (restoreStoreError) {
          return response({ error: "account_cleanup_failed" }, 503);
        }
      }
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) return response({ error: "account_cleanup_failed" }, 503);
    }
    return response({ deletedCount: targets.length });
  } catch {
    return response({ error: "account_cleanup_failed" }, 503);
  }
}
