import {
  access,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationDirectory = path.join(root, "supabase", "migrations");
const fixtureMigrationName =
  "20260718025000_test_seed_required_owner_identity.sql";
const secondOperatorFixtureMigrationName =
  "20260718055000_test_promote_required_second_operator.sql";
const executableName = (name) =>
  process.platform === "win32" ? `${name}.exe` : name;
const supabase = executableName("supabase");
const psql = executableName("psql");
const excludedServices = [
  "edge-runtime",
  "gotrue",
  "imgproxy",
  "kong",
  "logflare",
  "mailpit",
  "postgres-meta",
  "postgrest",
  "realtime",
  "storage-api",
  "studio",
  "supavisor",
  "vector",
].join(",");

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PGPASSWORD: process.env.NINETY_NINE_TEST_DB_PASSWORD ?? "postgres",
    },
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = capture
      ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`
      : "";
    throw new Error(
      `${path.basename(command)} exited with ${result.status}.${details}`,
    );
  }
  return result;
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a port.")));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolve(address.port),
      );
    });
  });
}

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "ninety-nine-unified-v2-"),
);
const temporarySupabase = path.join(temporaryRoot, "supabase");
const temporaryMigrations = path.join(temporarySupabase, "migrations");
const projectId = `ninety-nine-v2-${process.pid}-${Date.now()}`.toLowerCase();
const databasePort = await reservePort();
const shadowPort = await reservePort();
let started = false;
let testFailure;
let cleanupFailure;

try {
  await access(path.join(root, "supabase", "config.toml"));
  await access(
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2-bootstrap.sql",
    ),
  );
  await access(
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2-second-operator.sql",
    ),
  );
  await access(
    path.join(
      root,
      "tests",
      "integration",
      "role-center-buyer-preflight.sql",
    ),
  );
  await access(
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2.sql",
    ),
  );
  run(supabase, ["--version"], { capture: true });
  run(psql, ["--version"], { capture: true });

  await mkdir(temporaryMigrations, { recursive: true });
  await cp(migrationDirectory, temporaryMigrations, { recursive: true });
  await copyFile(
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2-bootstrap.sql",
    ),
    path.join(temporaryMigrations, fixtureMigrationName),
  );
  await copyFile(
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2-second-operator.sql",
    ),
    path.join(temporaryMigrations, secondOperatorFixtureMigrationName),
  );

  const migrationNames = (await readdir(temporaryMigrations)).sort();
  const fixturePosition = migrationNames.indexOf(fixtureMigrationName);
  const expectedPrevious = "20260718023000_gate_required_kakao_profiles.sql";
  const expectedNext = "20260718030000_add_role_levels_revenue_enforcement.sql";
  if (
    fixturePosition < 1 ||
    migrationNames[fixturePosition - 1] !== expectedPrevious ||
    migrationNames[fixturePosition + 1] !== expectedNext
  ) {
    throw new Error(
      "The owner fixture migration no longer sorts immediately before the migration that requires it.",
    );
  }
  const secondOperatorFixturePosition = migrationNames.indexOf(
    secondOperatorFixtureMigrationName,
  );
  if (
    secondOperatorFixturePosition < 1 ||
    migrationNames[secondOperatorFixturePosition - 1] !==
      "20260718054000_add_owner_mode_pin_attempt_rpc.sql" ||
    migrationNames[secondOperatorFixturePosition + 1] !==
      "20260718060000_hidden_owner_delegation_and_test_member.sql"
  ) {
    throw new Error(
      "The second operator fixture no longer sorts immediately before the migration that requires it.",
    );
  }

  const sourceConfig = await readFile(
    path.join(root, "supabase", "config.toml"),
    "utf8",
  );
  const testConfig = sourceConfig
    .replace(/^project_id\s*=\s*"[^"]+"/mu, `project_id = "${projectId}"`)
    .replace(
      /(\[db\][\s\S]*?^port\s*=\s*)\d+/mu,
      `$1${databasePort}`,
    )
    .replace(
      /(\[db\][\s\S]*?^shadow_port\s*=\s*)\d+/mu,
      `$1${shadowPort}`,
    )
    .replace(
      /(\[db\.seed\][\s\S]*?^enabled\s*=\s*)true/mu,
      "$1false",
    );
  await writeFile(path.join(temporarySupabase, "config.toml"), testConfig);

  console.log(
    `[unified-v2-db] starting isolated Supabase Postgres on ${databasePort}`,
  );
  run(supabase, [
    "start",
    "--workdir",
    temporaryRoot,
    "--exclude",
    excludedServices,
    "--yes",
  ]);
  started = true;

  const psqlBase = [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    "127.0.0.1",
    "-p",
    String(databasePort),
    "-U",
    "postgres",
    "-d",
    "postgres",
  ];
  console.log("[unified-v2-db] running seeded runtime contracts");
  run(psql, [
    ...psqlBase,
    "-f",
    path.join(root, "tests", "integration", "role-center-buyer-preflight.sql"),
  ]);
  run(psql, [
    ...psqlBase,
    "-v",
    `test_port=${databasePort}`,
    "-v",
    "test_database=postgres",
    "-v",
    "test_user=postgres",
    "-v",
    "test_password=postgres",
    "-f",
    path.join(
      root,
      "tests",
      "integration",
      "unified-inventory-fulfillment-v2.sql",
    ),
  ]);
  console.log("[unified-v2-db] all runtime contracts passed");
} catch (error) {
  testFailure = error;
} finally {
  if (started) {
    try {
      console.log(`[unified-v2-db] removing isolated project ${projectId}`);
      run(supabase, ["stop", "--project-id", projectId, "--no-backup"]);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
    try {
      await access(temporaryRoot);
      cleanupFailure ??= new Error(
        `Temporary project still exists: ${temporaryRoot}`,
      );
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
  } catch (error) {
    cleanupFailure ??= error;
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError(
    [testFailure, cleanupFailure],
    "Unified v2 database test and cleanup failed.",
  );
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[unified-v2-db] temporary project removed");
