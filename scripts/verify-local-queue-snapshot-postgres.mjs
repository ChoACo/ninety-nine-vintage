import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postgresBin = process.env.NINETY_NINE_PG_BIN;

if (!postgresBin) {
  throw new Error(
    "NINETY_NINE_PG_BIN must point to a PostgreSQL bin directory containing initdb, pg_ctl, and psql.",
  );
}

const executable = (name) =>
  path.join(postgresBin, process.platform === "win32" ? `${name}.exe` : name);
const initdb = executable("initdb");
const pgCtl = executable("pg_ctl");
const psql = executable("psql");

for (const target of [initdb, pgCtl, psql]) await access(target);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.capture
      ? `\n${result.stdout ?? ""}${result.stderr ?? ""}`
      : "";
    throw new Error(`${path.basename(command)} exited with ${result.status}.${details}`);
  }
  return result;
}

async function reservePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not reserve a PostgreSQL port.")));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ninety-nine-queue-snapshot-"));
const dataDirectory = path.join(temporaryRoot, "data");
const logPath = path.join(temporaryRoot, "postgres.log");
const port = await reservePort();
let started = false;
let testFailure = null;
let cleanupFailure = null;

try {
  console.log(`[queue-snapshot-db] initializing PostgreSQL on temporary port ${port}`);
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

  const baseArgs = [
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
    "postgres",
  ];
  const sqlFiles = [
    "tests/sql/queue-snapshot/00-bootstrap.sql",
    "supabase/migrations/20260722010000_shared_commerce_payment_queue_snapshot.sql",
    "tests/sql/queue-snapshot/10-contract.sql",
    "tests/sql/queue-snapshot/20-concurrency.sql",
  ];
  for (const sqlFile of sqlFiles) {
    console.log(`[queue-snapshot-db] applying ${sqlFile}`);
    const args = [...baseArgs];
    if (sqlFile.endsWith("20-concurrency.sql")) {
      args.push("-v", `test_port=${port}`);
    }
    args.push("-f", path.join(root, sqlFile));
    run(psql, args);
  }
  console.log("[queue-snapshot-db] PostgreSQL queue snapshot contracts passed");
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
      cleanupFailure ??= new Error(`Temporary cluster still exists: ${temporaryRoot}`);
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
    }
  } catch (error) {
    cleanupFailure ??= error;
  }
}

if (testFailure && cleanupFailure) {
  throw new AggregateError([testFailure, cleanupFailure], "Queue snapshot test and cleanup failed.");
}
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[queue-snapshot-db] temporary cluster removed");
