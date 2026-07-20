import { createClient } from "@supabase/supabase-js";

function required(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing ${name}`);
}

const client = createClient(
  required("NEXT_PUBLIC_SUPABASE_URL", ["SUPABASE_URL"]),
  required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"]),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const archiveFields = new Set(["product_id", "title", "description", "brand", "brand_slug", "brand_source", "category", "status", "size_label", "condition_grade", "measurements", "inspection_notes", "image_urls", "thumbnail_urls", "sold_at", "winning_amount", "winner_display_name", "participant_count"]);
const detailFields = new Set([...archiveFields].filter((field) => field !== "brand_source"));

function assertFields(record, allowed, label) {
  const unexpected = Object.keys(record).filter((field) => !allowed.has(field));
  if (unexpected.length > 0) throw new Error(`${label} returned non-public fields`);
}

const [{ data: brands, error: brandError }, { data: archive, error: archiveError }] = await Promise.all([
  client.rpc("get_public_sold_brands"),
  client.rpc("get_public_sold_auctions", { p_limit: 25, p_before: null, p_before_id: null, p_brand_slug: null }),
]);
if (brandError) throw new Error(`Brand RPC failed (${brandError.code ?? "unknown"})`);
if (archiveError) throw new Error(`Archive RPC failed (${archiveError.code ?? "unknown"})`);
if (new Set((brands ?? []).map((brand) => brand.brand_slug)).size !== (brands ?? []).length) throw new Error("Brand slugs are not unique");
for (const product of archive ?? []) assertFields(product, archiveFields, "Archive RPC");

let detailChecked = false;
const first = archive?.[0];
if (first) {
  const [{ data: detail, error: detailError }, { data: filtered, error: filterError }] = await Promise.all([
    client.rpc("get_public_sold_product", { p_product_id: first.product_id }),
    client.rpc("get_public_sold_auctions", { p_limit: 24, p_before: null, p_before_id: null, p_brand_slug: first.brand_slug }),
  ]);
  if (detailError || !detail?.[0]) throw new Error(`Detail RPC failed (${detailError?.code ?? "empty"})`);
  if (filterError) throw new Error(`Brand filter failed (${filterError.code ?? "unknown"})`);
  assertFields(detail[0], detailFields, "Detail RPC");
  if ((filtered ?? []).some((product) => product.brand_slug !== first.brand_slug)) throw new Error("Brand filter leaked another slug");
  detailChecked = true;
}

console.log(`PASS sold archive RPCs (brands=${brands?.length ?? 0}, archive=${archive?.length ?? 0}, detail=${detailChecked ? "checked" : "no-record"})`);
