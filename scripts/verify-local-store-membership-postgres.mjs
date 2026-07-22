import { access, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableName = (name) =>
  process.platform === "win32" ? `${name}.exe` : name;

function pgConfigBin() {
  const command = process.platform === "win32" ? "pg_config.exe" : "pg_config";
  const result = spawnSync(command, ["--bindir"], {
    encoding: "utf8",
    stdio: "pipe",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function resolvePostgresBin() {
  const candidates = [
    process.env.NINETY_NINE_PG_BIN,
    pgConfigBin(),
    process.platform === "win32"
      ? path.join(homedir(), "scoop", "apps", "postgresql", "current", "bin")
      : "",
    "/usr/local/pgsql/bin",
    "/usr/lib/postgresql/18/bin",
    "/usr/lib/postgresql/17/bin",
  ].filter(Boolean);

  for (const candidate of [...new Set(candidates)]) {
    try {
      await Promise.all(
        ["initdb", "pg_ctl", "postgres", "psql"].map((name) =>
          access(path.join(candidate, executableName(name))),
        ),
      );
      const postgresPath = path.join(candidate, executableName("postgres"));
      const result = spawnSync(postgresPath, ["--version"], {
        encoding: "utf8",
        stdio: "pipe",
      });
      const version = result.status === 0 ? result.stdout.trim() : "";
      const majorVersion = Number(
        /\bPostgreSQL\)?\s+(\d+)(?:\.|\b)/u.exec(version)?.[1],
      );
      if (Number.isSafeInteger(majorVersion) && majorVersion >= 17) {
        return { bin: candidate, version };
      }
    } catch {
      // Try the next explicit installation location.
    }
  }

  throw new Error(
    "PostgreSQL 17 or newer binaries were not found. Install PostgreSQL or set NINETY_NINE_PG_BIN to its bin directory.",
  );
}

const { bin: postgresBin, version } = await resolvePostgresBin();
const executable = (name) => path.join(postgresBin, executableName(name));
const [initdb, pgCtl, psql] = ["initdb", "pg_ctl", "psql"].map(executable);

function run(command, args, { capture = false, expectFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: capture || expectFailure ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;

  if (expectFailure) {
    if (result.status === 0) {
      throw new Error(`${path.basename(command)} unexpectedly succeeded.`);
    }
    return result;
  }

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
        server.close(() =>
          reject(new Error("Could not reserve a PostgreSQL port.")),
        );
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolve(address.port),
      );
    });
  });
}

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), "ninety-nine-store-membership-"),
);
const dataDirectory = path.join(temporaryRoot, "data");
const logPath = path.join(temporaryRoot, "postgres.log");
const port = await reservePort();
let started = false;
let testFailure;
let cleanupFailure;

try {
  console.log(
    `[store-membership-db] initializing ${version} on temporary port ${port}`,
  );
  run(initdb, [
    "-D",
    dataDirectory,
    "--username=postgres",
    "--encoding=UTF8",
    "--locale=C",
    "--auth=trust",
  ]);
  run(pgCtl, [
    "-D",
    dataDirectory,
    "-l",
    logPath,
    "-o",
    `-p ${port} -h 127.0.0.1`,
    "start",
    "-w",
  ]);
  started = true;

  const argsFor = (database) => [
    "-X",
    "-v",
    "ON_ERROR_STOP=1",
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "postgres",
    "-d",
    database,
  ];
  const applyFile = async (database, sqlFile, options = {}) => {
    const absolute = path.join(root, sqlFile);
    await access(absolute);
    console.log(`[store-membership-db] applying ${sqlFile} to ${database}`);
    return run(psql, [...argsFor(database), "-f", absolute], options);
  };

  run(psql, [...argsFor("postgres"), "-c", "create database membership_drift"]);
  await applyFile(
    "membership_drift",
    "tests/sql/store-membership-permissions/00-bootstrap.sql",
  );
  await applyFile(
    "membership_drift",
    "tests/sql/store-membership-permissions/06-invalid-legacy-state.sql",
  );
  const driftResult = await applyFile(
    "membership_drift",
    "supabase/migrations/20260722040000_add_store_memberships_permissions.sql",
    { expectFailure: true },
  );
  const driftOutput = `${driftResult.stdout ?? ""}${driftResult.stderr ?? ""}`;
  if (!driftOutput.includes("유효한 운영자가 아닌 stores.operator_id")) {
    throw new Error(
      `Invalid legacy store assignment failed for an unexpected reason.\n${driftOutput}`,
    );
  }
  console.log("[store-membership-db] invalid legacy operator failed closed");

  for (const sqlFile of [
    "tests/sql/store-membership-permissions/00-bootstrap.sql",
    "tests/sql/store-membership-permissions/05-legacy-state.sql",
    "supabase/migrations/20260722040000_add_store_memberships_permissions.sql",
    "tests/sql/store-membership-permissions/10-contract.sql",
  ]) {
    await applyFile("postgres", sqlFile);
  }

  console.log("[store-membership-db] PostgreSQL permission contracts passed");
} catch (error) {
  testFailure = error;
} finally {
  if (started) {
    try {
      run(pgCtl, ["-D", dataDirectory, "stop", "-m", "fast", "-w"]);
    } catch (error) {
      cleanupFailure = error;
    }
  }

  try {
    await rm(temporaryRoot, { recursive: true, force: true });
    try {
      await access(temporaryRoot);
      cleanupFailure ??= new Error(
        `Temporary cluster still exists: ${temporaryRoot}`,
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
    "Store-membership test and cleanup failed.",
  );
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[store-membership-db] temporary cluster removed");
