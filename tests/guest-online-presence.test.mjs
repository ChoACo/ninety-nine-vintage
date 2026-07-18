import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("shows ephemeral guest presence on the public feed without storing guests", async () => {
  const [app, hook, sidebar, client, migration] = await Promise.all([
    source("src/components/AuctionApp.tsx"),
    source("src/hooks/useOnlineMembers.ts"),
    source("src/components/live/OnlineMembersSidebar.tsx"),
    source("src/lib/supabase/client.ts"),
    source("supabase/migrations/20260718101000_public_guest_online_directory.sql"),
  ]);

  assert.match(app, /const showOnlineMembers = isFeedPage/);
  assert.match(
    app,
    /enabled: isFeedPage && !auth\.isLoading && showOnlineMembers/,
  );

  assert.match(hook, /GUEST_SESSION_KEY = "ninety-nine-guest-presence-id"/);
  assert.match(hook, /GUEST_ID_PATTERN = \/\^\[A-F0-9\]\{8\}\$\//);
  assert.match(hook, /window\.sessionStorage\.getItem\(GUEST_SESSION_KEY\)/);
  assert.match(hook, /displayName: `게스트\(\$\{guestId\}\)`/);
  assert.match(hook, /PUBLIC_GUEST_PRESENCE_CHANNEL/);
  assert.match(hook, /createSupabasePresenceClient/);
  assert.match(hook, /presenceClient\.channel\(PUBLIC_GUEST_PRESENCE_CHANNEL/);
  assert.match(hook, /config: \{ presence: \{ key: viewerKey \} \}/);
  assert.match(hook, /guestChannel\.track\(\{ guest_id: guestId \}\)/);
  assert.match(hook, /guestChannel\.presenceState\(\)/);
  assert.match(hook, /presenceClient\.removeChannel\(guestChannel\)/);
  assert.match(hook, /isGuest: true/);
  assert.match(client, /persistSession: false/);
  assert.match(client, /"ninety-nine-public-presence-auth"/);
  assert.doesNotMatch(migration, /create table[^;]*guest/i);

  assert.match(sidebar, /온라인 게스트 목록/);
  assert.match(sidebar, /guests\.map\(\(guest\)/);
  assert.match(sidebar, /guest\.displayName/);

  assert.match(migration, /security definer/);
  assert.match(migration, /statement_timestamp\(\) - interval '75 seconds'/);
  assert.match(migration, /profiles\.nickname_initialized_at is not null/);
  assert.match(migration, /not public\.is_owner_hidden_test_member/);
  assert.match(migration, /to anon, authenticated/);
  assert.doesNotMatch(migration, /auth\.uid\(\) is null/);
});
