import { spawn } from "node:child_process";
import path from "node:path";

import {
  prepareLocalTestSupabase,
  readLocalSupabaseEnvironment,
  root,
  runLocalSupabase,
} from "./local-test-supabase.mjs";

try {
  await prepareLocalTestSupabase();
  runLocalSupabase(["start"]);
  const { apiUrl, anonKey, serviceRoleKey } = readLocalSupabaseEnvironment();
  const next = spawn(
    process.execPath,
    [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", "3000"],
    {
      cwd: root,
      env: {
        ...process.env,
        LOCAL_TEST_ACCOUNT_PASSWORD: "ninety-nine-local-test-password",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonKey,
        NEXT_PUBLIC_SUPABASE_URL: apiUrl,
        SUPABASE_SECRET_KEY: serviceRoleKey,
        SUPABASE_URL: apiUrl,
      },
      stdio: "inherit",
    },
  );

  next.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
