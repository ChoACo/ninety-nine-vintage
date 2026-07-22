import { existsSync } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = path.join(root, "compose.central-fulfillment-test.yml");
const suiteDirectory = "tests/sql/central-fulfillment-foundation";
const migrationDirectory = "supabase/migrations";
const serviceName = "central-fulfillment-postgres";
const databaseName = "central_fulfillment_test";
const databaseUser = "central_fulfillment_test";
const projectName = `ninety-nine-central-fulfillment-${process.pid}-${Date.now()}`
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
    .filter((name) => /^\d+_add_central_fulfillment_foundation\.sql$/u.test(name))
    .sort();

  if (matchingMigrations.length !== 1) {
    throw new Error(
      `Expected exactly one migration matching ${migrationDirectory}/<timestamp>_add_central_fulfillment_foundation.sql; found ${matchingMigrations.length}.`,
    );
  }

  return [
    "/sql/central-fulfillment-foundation/00-bootstrap.sql",
    "/sql/central-fulfillment-foundation/05-legacy-state.sql",
    `/sql/migrations/${matchingMigrations[0]}`,
    "/sql/central-fulfillment-foundation/10-contract.sql",
  ];
}

function verifyDockerComposeV2() {
  try {
    run(docker, ["version", "--format", "{{.Server.Version}}"], { capture: true });
  } catch (error) {
    throw new Error(
      "Docker engine is unavailable. Start Docker Desktop, then retry this command.",
      { cause: error },
    );
  }
  const result = run(docker, ["compose", "version", "--short"], { capture: true });
  const version = result.stdout.trim();
  if (!version) {
    throw new Error("Docker Compose v2 did not return a version. Install or enable the Docker Compose v2 plugin.");
  }
  console.log(`[central-fulfillment-db] Docker Compose v2 ${version}`);
}

function applySql(containerPath) {
  console.log(`[central-fulfillment-db] applying ${containerPath}`);
  run(docker, composeArgs(
    "exec",
    "--no-TTY",
    serviceName,
    "psql",
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "-f",
    containerPath,
  ));
}

function printPostgresVersion() {
  const result = run(docker, composeArgs(
    "exec",
    "--no-TTY",
    serviceName,
    "psql",
    "-X",
    "-At",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "-c",
    "select version();",
  ), { capture: true });
  const version = result.stdout.trim();
  if (!/^PostgreSQL 17\./u.test(version)) {
    throw new Error(`Expected PostgreSQL 17.x, received: ${version || "no version output"}`);
  }
  console.log(`[central-fulfillment-db] ${version}`);
}

function assertProjectRemoved() {
  const filters = [
    ["ps", "--all", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`],
    ["network", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`],
    ["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${projectName}`],
  ];
  const leftovers = filters.flatMap((args) => run(docker, args, { capture: true }).stdout.trim().split(/\s+/u).filter(Boolean));
  if (leftovers.length > 0) {
    throw new Error(`Docker Compose cleanup left resources behind: ${leftovers.join(", ")}`);
  }
}

let dockerWasVerified = false;
let testFailure = null;
let cleanupFailure = null;

try {
  const sqlPlan = await findSqlPlan();
  verifyDockerComposeV2();
  dockerWasVerified = true;
  console.log(`[central-fulfillment-db] starting isolated Compose project ${projectName}`);
  run(docker, composeArgs("up", "--detach", "--wait", serviceName));
  printPostgresVersion();
  for (const sqlFile of sqlPlan) applySql(sqlFile);
  console.log("[central-fulfillment-db] PostgreSQL foundation contracts passed");
} catch (error) {
  testFailure = error;
} finally {
  if (dockerWasVerified) {
    try {
      console.log("[central-fulfillment-db] removing isolated PostgreSQL container and volumes");
      run(docker, composeArgs("down", "--volumes", "--remove-orphans"));
      assertProjectRemoved();
    } catch (error) {
      cleanupFailure = error;
    }
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError([testFailure, cleanupFailure], "Central-fulfillment test and Docker cleanup failed.");
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[central-fulfillment-db] cleanup complete");
