import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, rootUrl), "utf8");

test("MY profile uses the authoritative nickname and realtime avatar state", async () => {
  const [header, uploader] = await Promise.all([
    source("src/components/features/mypage/ProfileHeader.tsx"),
    source("src/components/features/mypage/ProfileAvatarUploader.tsx"),
  ]);

  assert.match(header, /from\("profiles"\)/);
  assert.match(header, /select\("display_name, avatar_url"\)/);
  assert.match(header, /table: "profiles"/);
  assert.match(header, /filter: `id=eq\.\$\{user\.id\}`/);
  assert.match(header, /profile\?\.display_name/);
  assert.doesNotMatch(header, /빈티지 피플/);
  assert.match(uploader, /MAX_AVATAR_BYTES = 5 \* 1024 \* 1024/);
  assert.match(uploader, /image\/jpeg,image\/png,image\/webp/);
  assert.match(uploader, /`\$\{userId\}\/avatar`/);
  assert.match(uploader, /\.from\("member-avatars"\)/);
  assert.match(uploader, /supabase\.auth\.updateUser/);
});

test("avatar storage is public-read and user-folder write scoped without bypasses", async () => {
  const migration = await source(
    "supabase/migrations/20260822194130_add_member_profile_avatars.sql",
  );

  assert.match(migration, /'member-avatars'/);
  assert.match(migration, /file_size_limit[\s\S]*5242880/);
  assert.match(migration, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/);
  assert.match(
    migration,
    /for insert[\s\S]*to authenticated[\s\S]*storage\.foldername\(name\)\)\[1\][\s\S]*auth\.uid/,
  );
  assert.match(migration, /for update[\s\S]*with check/);
  assert.match(migration, /for delete/);
  assert.doesNotMatch(migration, /or true/i);
});
