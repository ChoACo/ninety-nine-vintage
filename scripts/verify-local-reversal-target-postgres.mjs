import { access, mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executableName = (name) => process.platform === "win32" ? `${name}.exe` : name;

function pgConfigBin() {
  const command = process.platform === "win32" ? "pg_config.exe" : "pg_config";
  const result = spawnSync(command, ["--bindir"], { encoding: "utf8", stdio: "pipe" });
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
    "/usr/lib/postgresql/16/bin",
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      await Promise.all(
        ["initdb", "pg_ctl", "psql"].map((name) =>
          access(path.join(candidate, executableName(name))),
        ),
      );
      return candidate;
    } catch {
      // Try the next explicit installation location.
    }
  }
  throw new Error(
    "PostgreSQL binaries were not found. Install PostgreSQL or set NINETY_NINE_PG_BIN to a bin directory containing initdb, pg_ctl, and psql.",
  );
}

const postgresBin = await resolvePostgresBin();
const executable = (name) => path.join(postgresBin, executableName(name));
const [initdb, pgCtl, psql] = ["initdb", "pg_ctl", "psql"].map(executable);

function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: process.env, stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}.${capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : ""}`);
}
async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") return server.close(() => reject(new Error("Could not reserve a PostgreSQL port."))); server.close((error) => error ? reject(error) : resolve(address.port)); });
  });
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "ninety-nine-reversal-target-"));
const dataDirectory = path.join(temporaryRoot, "data");
const port = await reservePort();
let started = false; let testFailure; let cleanupFailure;
try {
  console.log(`[reversal-target-db] initializing PostgreSQL on temporary port ${port}`);
  run(initdb, ["-D", dataDirectory, "--username=postgres", "--encoding=UTF8", "--locale=C", "--auth=trust"]);
  run(pgCtl, ["-D", dataDirectory, "-l", path.join(temporaryRoot, "postgres.log"), "-o", `-p ${port} -h 127.0.0.1`, "start", "-w"]); started = true;
  const base = ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-U", "postgres", "-d", "postgres"];
  for (const sqlFile of ["tests/sql/reversal-target-binding/00-bootstrap.sql", "tests/sql/reversal-target-binding/05-legacy-state.sql", "supabase/migrations/20260722020000_harden_manual_transfer_reversal.sql", "tests/sql/reversal-target-binding/10-contract.sql", "tests/sql/reversal-target-binding/20-concurrency.sql"]) {
    const variables = sqlFile.endsWith("20-concurrency.sql")
      ? ["-v", `test_port=${port}`, "-v", "test_database=postgres", "-v", "test_user=postgres", "-v", "test_password=reversal_target_test_only"]
      : [];
    console.log(`[reversal-target-db] applying ${sqlFile}`); run(psql, [...base, ...variables, "-f", path.join(root, sqlFile)]);
  }
  console.log("[reversal-target-db] PostgreSQL reversal target-binding contracts passed");
} catch (error) { testFailure = error; }
finally {
  if (started) try { run(pgCtl, ["-D", dataDirectory, "stop", "-m", "fast", "-w"]); } catch (error) { cleanupFailure = error; }
  try { await rm(temporaryRoot, { recursive: true, force: true }); await access(temporaryRoot); cleanupFailure ??= new Error(`Temporary cluster still exists: ${temporaryRoot}`); }
  catch (error) { if (!error || typeof error !== "object" || error.code !== "ENOENT") cleanupFailure ??= error; }
}
if (testFailure && cleanupFailure) throw new AggregateError([testFailure, cleanupFailure], "Reversal target test and cleanup failed.");
if (testFailure) throw testFailure;
if (cleanupFailure) throw cleanupFailure;
console.log("[reversal-target-db] temporary cluster removed");
