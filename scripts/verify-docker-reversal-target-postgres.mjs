import { existsSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "compose.reversal-test.yml");
const suiteDirectory = "tests/sql/reversal-target-binding";
const migrationDirectory = "supabase/migrations";
const serviceName = "reversal-target-postgres";
const databaseName = "reversal_target_test";
const databaseUser = "reversal_target_test";
const databasePassword = "reversal_target_test_only";
const projectName = `ninety-nine-reversal-target-${process.pid}-${Date.now()}`
  .replace(/[^a-z0-9_-]/gi, "")
  .toLowerCase();
const installedWindowsDocker =
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const docker = process.env.NINETY_NINE_DOCKER_EXE ?? (
  process.platform === "win32" && existsSync(installedWindowsDocker)
    ? installedWindowsDocker
    : process.platform === "win32"
      ? "docker.exe"
      : "docker"
);
const requiredSuiteFiles = [
  "00-bootstrap.sql",
  "05-legacy-state.sql",
  "10-contract.sql",
  "20-concurrency.sql",
];

function commandText(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(" ");
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw new Error(`Could not run ${commandText(command, args)}: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const output = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${commandText(command, args)} exited with ${result.status}.${output}`);
  }
  return result;
}

function composeArgs(...args) {
  return ["compose", "--project-name", projectName, "--file", composeFile, ...args];
}

async function findSqlPlan() {
  await access(composeFile);
  for (const file of requiredSuiteFiles) {
    await access(path.join(root, suiteDirectory, file));
  }

  const migrationNames = await readdir(path.join(root, migrationDirectory));
  const matchingMigrations = migrationNames
    .filter((name) => /^\d+_harden_manual_transfer_reversal\.sql$/u.test(name))
    .sort();

  if (matchingMigrations.length !== 1) {
    throw new Error(
      `Expected exactly one migration matching ${migrationDirectory}/<timestamp>_harden_manual_transfer_reversal.sql; found ${matchingMigrations.length}.`,
    );
  }

  return [
    "/sql/reversal-target-binding/00-bootstrap.sql",
    "/sql/reversal-target-binding/05-legacy-state.sql",
    `/sql/migrations/${matchingMigrations[0]}`,
    "/sql/reversal-target-binding/10-contract.sql",
    "/sql/reversal-target-binding/20-concurrency.sql",
  ];
}

function verifyDockerComposeV2() {
  try {
    run(docker, ["version", "--format", "{{.Server.Version}}"], { capture: true });
  } catch (error) {
    throw new Error(
      "Docker engine is unavailable. Start Docker Desktop (and complete the pending Windows reboot when WSL 2 was just enabled), then retry this command.",
      { cause: error },
    );
  }
  const result = run(docker, ["compose", "version", "--short"], { capture: true });
  const version = result.stdout.trim();
  if (!version) {
    throw new Error("Docker Compose v2 did not return a version. Install or enable the Docker Compose v2 plugin.");
  }
  console.log(`[reversal-target-db] Docker Compose v2 ${version}`);
}

function applySql(containerPath) {
  const variables = containerPath.endsWith("/20-concurrency.sql")
    ? ["-v", "test_port=5432", "-v", `test_database=${databaseName}`, "-v", `test_user=${databaseUser}`, "-v", `test_password=${databasePassword}`]
    : [];
  console.log(`[reversal-target-db] applying ${containerPath}`);
  run(docker, composeArgs(
    "exec",
    "--no-TTY",
    serviceName,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    ...variables,
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "-f",
    containerPath,
  ));
}

let dockerWasVerified = false;
let testFailure = null;
let cleanupFailure = null;

try {
  const sqlPlan = await findSqlPlan();
  verifyDockerComposeV2();
  dockerWasVerified = true;
  console.log(`[reversal-target-db] starting isolated Compose project ${projectName}`);
  run(docker, composeArgs("up", "--detach", "--wait", serviceName));
  for (const sqlFile of sqlPlan) applySql(sqlFile);
  console.log("[reversal-target-db] PostgreSQL reversal-target contracts passed");
} catch (error) {
  testFailure = error;
} finally {
  if (dockerWasVerified) {
    try {
      console.log("[reversal-target-db] removing isolated PostgreSQL container and volumes");
      run(docker, composeArgs("down", "--volumes", "--remove-orphans"));
    } catch (error) {
      cleanupFailure = error;
    }
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError([testFailure, cleanupFailure], "Reversal-target test and Docker cleanup failed.");
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[reversal-target-db] cleanup complete");
