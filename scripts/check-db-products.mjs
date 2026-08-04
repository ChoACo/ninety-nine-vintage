import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load env.local manually to make sure it's loaded
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  const raw = match[2].split("#")[0].trim();
  try {
    process.env[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw.replace(/^'(.*)'$/, "$1");
  } catch {
    process.env[match[1]] = raw;
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const client = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await client.from("products").select("id, title, status, sale_type, publish_at, current_price, fixed_price").limit(10);
  if (error) {
    console.error("Error fetching products:", error);
    return;
  }
  console.log(`Fetched ${data.length} products:`);
  console.log(JSON.stringify(data, null, 2));

  const { data: activeFixed, error: error2 } = await client.from("products").select("id, title, status, sale_type").eq("status", "active").eq("sale_type", "fixed");
  if (error2) {
    console.error("Error fetching active fixed products:", error2);
    return;
  }
  console.log(`Active fixed products: ${activeFixed.length}`);
  console.log(JSON.stringify(activeFixed, null, 2));
}

run();
