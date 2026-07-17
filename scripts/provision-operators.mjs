import { createClient } from "@supabase/supabase-js";

const OPERATOR_DOMAIN = "staff.ninety-nine-vintage.store";
const operatorDefinitions = [
  {
    idEnvironmentName: "OPERATOR01_ID",
    displayName: "운영자 1",
    passwordEnvironmentName: "OPERATOR01_PASSWORD",
  },
  {
    idEnvironmentName: "OPERATOR02_ID",
    displayName: "운영자 2",
    passwordEnvironmentName: "OPERATOR02_PASSWORD",
  },
];

const OPERATOR_ID_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
  return value;
}

function readOperators() {
  const operators = operatorDefinitions.map((definition) => {
    const rawId = requiredEnvironment(definition.idEnvironmentName);
    const id = rawId.toLowerCase();
    if (rawId !== id || !OPERATOR_ID_PATTERN.test(id)) {
      throw new Error(
        `${definition.idEnvironmentName}는 영문 소문자로 시작하고 영문 소문자, 숫자, 밑줄, 하이픈만 사용하는 3~32자 아이디여야 합니다.`,
      );
    }

    const password = requiredEnvironment(definition.passwordEnvironmentName);
    if (password.length < 12) {
      throw new Error(
        `${definition.passwordEnvironmentName}는 12자 이상으로 설정해 주세요.`,
      );
    }

    return { ...definition, id, password };
  });

  if (new Set(operators.map((operator) => operator.id)).size !== operators.length) {
    throw new Error("두 운영자 아이디는 서로 달라야 합니다.");
  }

  return operators;
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

async function linkOperatorSlot(client, operator, authUserId) {
  const operatorId = operator.id;
  const { data: existingSlot, error: existingSlotError } = await client
    .from("operator_accounts")
    .select("username, auth_user_id")
    .eq("username", operatorId)
    .maybeSingle();

  if (existingSlotError) throw existingSlotError;
  if (
    existingSlot?.auth_user_id &&
    existingSlot.auth_user_id !== authUserId
  ) {
    throw new Error(
      `${operatorId} 운영자 슬롯이 다른 Auth 사용자에게 연결되어 있어 수정하지 않았습니다.`,
    );
  }

  const { data, error } = await client
    .from("operator_accounts")
    .upsert(
      {
        username: operatorId,
        display_name: operator.displayName,
        auth_user_id: authUserId,
      },
      { onConflict: "username" },
    )
    .select("username")
    .single();

  if (error) throw error;
  if (data.username !== operatorId) {
    throw new Error(`${operatorId} 운영자 슬롯 연결을 확인하지 못했습니다.`);
  }
}

async function removeUnexpectedOperatorSlots(client, configuredOperatorIds) {
  const { data: slots, error: slotsError } = await client
    .from("operator_accounts")
    .select("username");

  if (slotsError) throw slotsError;

  const configuredIds = new Set(configuredOperatorIds);
  for (const slot of slots) {
    if (configuredIds.has(slot.username)) continue;

    const { error } = await client
      .from("operator_accounts")
      .delete()
      .eq("username", slot.username);
    if (error) throw error;
    console.log(`[unlinked] ${slot.username}`);
  }
}

function countRetiredOperatorUsers(existingUsers, configuredAuthUserIds) {
  const activeAuthUserIds = new Set(configuredAuthUserIds);
  return existingUsers.filter(
    (user) =>
      user.app_metadata?.role === "operator" &&
      !activeAuthUserIds.has(user.id),
  ).length;
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

  const operators = readOperators();
  const client = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  const existingUsers = await listAllUsers(client);
  const configuredAuthUserIds = [];

  for (const operator of operators) {
    const authUserId = await provisionOperator(
      client,
      existingUsers,
      operator,
      operator.password,
    );
    await linkOperatorSlot(client, operator, authUserId);
    configuredAuthUserIds.push(authUserId);
  }

  await removeUnexpectedOperatorSlots(
    client,
    operators.map((operator) => operator.id),
  );

  const retiredOperatorCount = countRetiredOperatorUsers(
    existingUsers,
    configuredAuthUserIds,
  );
  if (retiredOperatorCount > 0) {
    console.log(
      `[retired] ${retiredOperatorCount}개의 기존 operator Auth 사용자는 삭제·수정하지 않고 스태프 슬롯 없이 보존했습니다.`,
    );
  }

  console.log("사용자 지정 운영자 계정 2개를 안전하게 준비했습니다.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`운영자 계정 준비 실패: ${message}`);
  process.exitCode = 1;
});
