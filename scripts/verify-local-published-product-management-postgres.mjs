import { access, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableName = (name) => process.platform === "win32" ? `${name}.exe` : name;

function pgConfigBin() {
  const result = spawnSync(executableName("pg_config"), ["--bindir"], {
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
      await Promise.all(["initdb", "pg_ctl", "psql"].map((name) =>
        access(path.join(candidate, executableName(name))),
      ));
      return candidate;
    } catch {
      // Try the next explicit installation location.
    }
  }
  throw new Error("PostgreSQL binaries were not found.");
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}.`);
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a PostgreSQL port.")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const postgresBin = await resolvePostgresBin();
const executable = (name) => path.join(postgresBin, executableName(name));
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ninety-nine-published-products-"));
const dataDirectory = path.join(temporaryRoot, "data");
const logPath = path.join(temporaryRoot, "postgres.log");
const port = await reservePort();
let started = false;
let testFailure;
let cleanupFailure;

try {
  run(executable("initdb"), [
    "-D", dataDirectory,
    "--username=postgres",
    "--encoding=UTF8",
    "--locale=C",
    "--auth=trust",
  ]);
  run(executable("pg_ctl"), [
    "-D", dataDirectory,
    "-l", logPath,
    "-o", `-p ${port} -h 127.0.0.1`,
    "start", "-w",
  ]);
  started = true;

  const psqlBase = [
    "-X", "-v", "ON_ERROR_STOP=1",
    "-h", "127.0.0.1", "-p", String(port),
    "-U", "postgres", "-d", "postgres",
  ];
  for (const sqlFile of [
    "tests/sql/published-product-management/00-bootstrap.sql",
    "supabase/migrations/20260722152316_restore_published_product_management.sql",
    "tests/sql/published-product-management/10-contract.sql",
  ]) {
    await access(path.join(root, sqlFile));
    console.log(`[published-products-db] applying ${sqlFile}`);
    run(executable("psql"), [...psqlBase, "-f", path.join(root, sqlFile)]);
  }
  console.log("[published-products-db] PostgreSQL contracts passed");
} catch (error) {
  testFailure = error;
} finally {
  if (started) {
    try {
      run(executable("pg_ctl"), ["-D", dataDirectory, "stop", "-m", "fast", "-w"]);
    } catch (error) {
      cleanupFailure = error;
    }
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupFailure ??= error;
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError([testFailure, cleanupFailure], "Database test and cleanup failed.");
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[published-products-db] temporary cluster removed");

