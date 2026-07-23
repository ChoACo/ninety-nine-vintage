import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: tombstones, error } = await client.from("profiles").select("id,anonymized_reference").not("deleted_at", "is", null);
if (error) throw error;

for (const tombstone of tombstones ?? []) {
  const { error: deleteError } = await client.auth.admin.deleteUser(tombstone.id);
  if (deleteError && !/not found/i.test(deleteError.message)) throw deleteError;

  const { data: remaining, error: verificationError } = await client.auth.admin.getUserById(tombstone.id);
  const missing = verificationError && (verificationError.status === 404 || /not found/i.test(verificationError.message));
  if (!missing && remaining?.user) {
    throw new Error(`Auth subject ${tombstone.anonymized_reference} still exists after deletion.`);
  }
  if (verificationError && !missing) throw verificationError;
  process.stdout.write(`deleted-auth-subject ${tombstone.anonymized_reference}\n`);
}
