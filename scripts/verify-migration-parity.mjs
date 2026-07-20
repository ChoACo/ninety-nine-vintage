import { spawn } from "node:child_process";
import { parseSupabaseMigrationList } from "./migration-list-parser.mjs";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({ code: code ?? 1, output: `${stdout}\n${stderr}` }),
    );
  });
}

const command = process.platform === "win32" ? "supabase.exe" : "supabase";
const args = ["migration", "list", "--linked"];
let result = await run(command, args);
if (result.code !== 0) result = await run(command, args);
if (result.code !== 0) {
  console.error("FAIL migration parity (could not read the linked migration list)");
  process.exit(1);
}

const migrations = parseSupabaseMigrationList(result.output);
if (migrations.length === 0) {
  console.error("FAIL migration parity (Supabase CLI returned no migration rows)");
  process.exit(1);
}
const pending = migrations
  .filter(
    (migration) =>
      typeof migration?.local === "string" &&
      migration.local &&
      !migration.remote,
  )
  .map((migration) => migration.local);

if (pending.length > 0) {
  console.error(`FAIL migration parity (pending remote: ${pending.join(", ")})`);
  process.exit(1);
}

console.log(`PASS migration parity (${migrations.length} linked migrations)`);
