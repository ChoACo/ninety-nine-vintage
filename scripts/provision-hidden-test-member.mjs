import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const OWNER_ID = "30be08c2-6259-42c6-af26-4ded6362de12";
const DEFAULT_LABEL = "비공개 테스트 회원";

function requiredEnvironment(name, ...fallbackNames) {
  for (const candidate of [name, ...fallbackNames]) {
    const value = process.env[candidate]?.trim();
    if (value) return value;
  }
  throw new Error(`${name} environment variable is required.`);
}

const supabaseUrl = requiredEnvironment("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnvironment(
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
);
const label = process.env.HIDDEN_TEST_MEMBER_LABEL?.trim() || DEFAULT_LABEL;

if (label.length < 2 || label.length > 40) {
  throw new Error("HIDDEN_TEST_MEMBER_LABEL must contain 2 to 40 characters.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const { data: currentRows, error: currentError } = await admin.rpc(
  "get_owner_hidden_test_member_for_service",
  { p_actor_owner_id: OWNER_ID, p_include_retired: false },
);
if (currentError) throw currentError;
if (currentRows?.[0]?.test_user_id) {
  console.log(`Hidden test member is already provisioned: ${currentRows[0].test_user_id}`);
  process.exit(0);
}

// Credentials are intentionally generated in memory, never printed, and the
// account is banned from interactive sign-in. The Auth row exists only so bids,
// payments, addresses, and shipments exercise their real foreign keys.
const nonce = randomUUID();
const email = `owner-test-${nonce}@invalid.ninety-nine-vintage.local`;
const password = randomBytes(48).toString("base64url");
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  ban_duration: "876000h",
  user_metadata: { display_name: label },
  app_metadata: {
    role: "member",
    account_type: "owner_hidden_test",
    provisioned_by_owner: OWNER_ID,
  },
});
if (createError || !created.user) {
  throw createError ?? new Error("Supabase did not return the created Auth user.");
}

try {
  const { data: testUserId, error: provisionError } = await admin.rpc(
    "provision_owner_hidden_test_member",
    {
      p_actor_owner_id: OWNER_ID,
      p_test_user_id: created.user.id,
      p_label: label,
    },
  );
  if (provisionError) throw provisionError;
  if (testUserId !== created.user.id) {
    throw new Error("The provision RPC returned an unexpected Auth user ID.");
  }
  console.log(`Hidden test member provisioned: ${created.user.id}`);
} catch (error) {
  const { error: cleanupError } = await admin.auth.admin.deleteUser(created.user.id);
  if (cleanupError) {
    console.error(`Cleanup failed for hidden Auth user ${created.user.id}.`);
  }
  throw error;
}
