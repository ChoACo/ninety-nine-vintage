import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import webPush from "web-push";

const rotateKeys = process.argv.includes("--rotate");
const activateDispatch = process.argv.includes("--activate-dispatch");

if (!rotateKeys && !activateDispatch) {
  console.error(
    "Choose --rotate to configure keys or --activate-dispatch after deployment.",
  );
  process.exit(2);
}

const vapid = rotateKeys ? webPush.generateVAPIDKeys() : null;
const values = [
  ...(vapid ? [{
    name: "web_push_vapid_public_key",
    secret: vapid.publicKey,
    description: "Web Push VAPID public key",
  }, {
    name: "web_push_vapid_private_key",
    secret: vapid.privateKey,
    description: "Web Push VAPID private key",
  }, {
    name: "web_push_vapid_subject",
    secret: "mailto:privacy@ninety-nine-vintage.store",
    description: "Web Push VAPID subject",
  }, {
    name: "web_push_dispatch_secret",
    secret: randomBytes(48).toString("base64url"),
    description: "Cron dispatcher bearer secret",
  }] : []),
  ...(activateDispatch ? [{
    name: "web_push_dispatch_url",
    secret: "https://www.ninety-nine-vintage.store/api/push/dispatch",
    description: "Production Web Push dispatch endpoint",
  }] : []),
];

const serialized = JSON.stringify(values).replaceAll("'", "''");
const sql = `
do $vault$
declare
  v_item record;
  v_id uuid;
begin
  for v_item in
    select *
    from jsonb_to_recordset('${serialized}'::jsonb)
      as x(name text, secret text, description text)
  loop
    select id
    into v_id
    from vault.secrets
    where name = v_item.name
    limit 1;

    if v_id is null then
      perform vault.create_secret(
        v_item.secret,
        v_item.name,
        v_item.description
      );
    else
      perform vault.update_secret(
        v_id,
        v_item.secret,
        v_item.name,
        v_item.description
      );
    end if;
  end loop;
end
$vault$;
`.trim();

const executable = process.platform === "win32" ? process.execPath : "npx";
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "ninety-nine-web-push-"),
);
const sqlFilePath = join(temporaryDirectory, "configure.sql");
writeFileSync(sqlFilePath, sql, { encoding: "utf8", mode: 0o600 });
const commandArguments = process.platform === "win32"
  ? [
      join(
        process.env.ProgramFiles || "C:\\Program Files",
        "nodejs",
        "node_modules",
        "npm",
        "bin",
        "npx-cli.js",
      ),
      "supabase",
      "db",
      "query",
      "--linked",
      "--file",
      sqlFilePath,
    ]
  : ["supabase", "db", "query", "--linked", "--file", sqlFilePath];
let result;
try {
  result = spawnSync(executable, commandArguments, {
    encoding: "utf8",
    windowsHide: true,
  });
} finally {
  rmSync(sqlFilePath, { force: true });
  rmdirSync(temporaryDirectory);
}

if (result.status !== 0) {
  const diagnostic = `${result.error?.message || ""}\n${result.stderr || ""}\n${result.stdout || ""}`.trim();
  const redacted = values.reduce(
    (message, value) => message.replaceAll(value.secret, "[REDACTED]"),
    diagnostic,
  );
  console.error("Failed to configure Web Push secrets in Supabase Vault.");
  if (redacted) console.error(redacted.slice(-2000));
  process.exit(result.status ?? 1);
}

console.log(
  JSON.stringify({
    configuredSecretCount: values.length,
    vapidPublicKeyLength: vapid?.publicKey.length ?? null,
    dispatchActivated: activateDispatch,
  }),
);
