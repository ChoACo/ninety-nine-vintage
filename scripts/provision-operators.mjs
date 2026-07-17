import { createClient } from "@supabase/supabase-js";

const OPERATOR_DOMAIN = "staff.ninety-nine-vintage.store";
const operators = [
  {
    id: "operator01",
    displayName: "운영자 1",
    passwordEnvironmentName: "OPERATOR01_PASSWORD",
  },
  {
    id: "operator02",
    displayName: "운영자 2",
    passwordEnvironmentName: "OPERATOR02_PASSWORD",
  },
  {
    id: "operator03",
    displayName: "운영자 3",
    passwordEnvironmentName: "OPERATOR03_PASSWORD",
  },
];

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
  return value;
}

function readOperatorPasswords() {
  return new Map(
    operators.map((operator) => {
      const password = requiredEnvironment(operator.passwordEnvironmentName);
      if (password.length < 12) {
        throw new Error(
          `${operator.passwordEnvironmentName}는 12자 이상으로 설정해 주세요.`,
        );
      }
      return [operator.id, password];
    }),
  );
}

async function listAllUsers(client) {
  const users = [];
  const perPage = 1000;

  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

async function provisionOperator(client, existingUsers, operator, password) {
  const email = `${operator.id}@${OPERATOR_DOMAIN}`;
  const existing = existingUsers.find(
    (user) => user.email?.toLowerCase() === email,
  );
  const appMetadata = {
    role: "operator",
    operator_id: operator.id,
  };
  const userMetadata = {
    display_name: operator.displayName,
  };

  if (!existing) {
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
      user_metadata: userMetadata,
    });
    if (error) throw error;
    if (!data.user) throw new Error(`${operator.id} 계정 생성 결과가 없습니다.`);
    console.log(`[created] ${operator.id}`);
    return data.user.id;
  }

  const existingRole = existing.app_metadata?.role;
  const existingOperatorId = existing.app_metadata?.operator_id;

  // A synthetic address must never be allowed to downgrade or overwrite the
  // existing administrator (or take over an unrelated member account).
  if (existingRole === "admin") {
    throw new Error(
      `${operator.id} 주소가 관리자 계정에 사용 중이어서 수정하지 않았습니다.`,
    );
  }
  if (existingRole !== "operator" || existingOperatorId !== operator.id) {
    throw new Error(
      `${operator.id} 주소가 다른 계정에 사용 중이어서 수정하지 않았습니다.`,
    );
  }

  const { error } = await client.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: {
      ...existing.app_metadata,
      ...appMetadata,
    },
    user_metadata: {
      ...existing.user_metadata,
      ...userMetadata,
    },
  });
  if (error) throw error;
  console.log(`[updated] ${operator.id}`);
  return existing.id;
}

async function linkOperatorSlot(client, operatorId, authUserId) {
  const { data, error } = await client
    .from("operator_accounts")
    .update({ auth_user_id: authUserId })
    .eq("username", operatorId)
    .select("username")
    .single();

  if (error) throw error;
  if (data.username !== operatorId) {
    throw new Error(`${operatorId} 운영자 슬롯 연결을 확인하지 못했습니다.`);
  }
}

async function main() {
  const supabaseUrl = requiredEnvironment("SUPABASE_URL");
  const secretKey =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 필요합니다.",
    );
  }

  const passwords = readOperatorPasswords();
  const client = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const existingUsers = await listAllUsers(client);

  for (const operator of operators) {
    const authUserId = await provisionOperator(
      client,
      existingUsers,
      operator,
      passwords.get(operator.id),
    );
    await linkOperatorSlot(client, operator.id, authUserId);
  }

  console.log("운영자 계정 3개를 안전하게 준비했습니다.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`운영자 계정 준비 실패: ${message}`);
  process.exitCode = 1;
});
