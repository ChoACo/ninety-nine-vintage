import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../src/lib/kakao/oidc.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const oidc = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("omits explicit Kakao scopes so only console-approved consent items are requested", async () => {
  const rawNonce = "nonce-value";
  const hashedNonce = await oidc.hashTokenSha256(rawNonce);
  const authorizeUrl = oidc.buildKakaoAuthorizeUrl(
    {
      clientId: "public-rest-key",
      clientSecret: "server-secret",
      redirectUri: "https://example.com/api/auth/kakao/oidc",
    },
    "state-value",
    hashedNonce,
  );

  assert.equal(authorizeUrl.origin, "https://kauth.kakao.com");
  assert.equal(authorizeUrl.pathname, "/oauth/authorize");
  assert.equal(authorizeUrl.searchParams.has("scope"), false);
  assert.equal(authorizeUrl.searchParams.get("state"), "state-value");
  assert.equal(authorizeUrl.searchParams.get("nonce"), hashedNonce);
  assert.notEqual(hashedNonce, rawNonce);
  assert.match(hashedNonce, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(
    authorizeUrl.toString(),
    /account_email|phone_number|profile_image|name|gender|birthyear/,
  );
});

test("uses secure, HTTP-only transient cookies and validates state safely", () => {
  const cookie = oidc.serializeHttpOnlyCookie(
    "https://example.com/api/auth/kakao/start",
    oidc.KAKAO_STATE_COOKIE,
    "state-value",
    600,
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /Path=\/api\/auth\/kakao/);

  const accessTokenCookie = oidc.serializeHttpOnlyCookie(
    "https://example.com/api/auth/kakao/oidc",
    oidc.KAKAO_ACCESS_TOKEN_COOKIE,
    "access-token",
    120,
  );
  assert.match(accessTokenCookie, /Path=\/api\/auth\/kakao\/profile/);

  const request = new Request("https://example.com/api/auth/kakao/oidc", {
    headers: { cookie: `${oidc.KAKAO_STATE_COOKIE}=state-value; extra=1` },
  });
  assert.equal(oidc.readCookie(request, oidc.KAKAO_STATE_COOKIE), "state-value");
  assert.equal(oidc.timingSafeStringEqual("same", "same"), true);
  assert.equal(oidc.timingSafeStringEqual("same", "different"), false);
  assert.equal(oidc.timingSafeStringEqual(null, "same"), false);
});

test("rejects cross-site OIDC session handoff requests", () => {
  const sameOrigin = new Request("https://example.com/api/auth/kakao/session", {
    headers: {
      origin: "https://example.com",
      "sec-fetch-site": "same-origin",
    },
  });
  const crossOrigin = new Request("https://example.com/api/auth/kakao/session", {
    headers: {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
  });

  assert.equal(oidc.hasTrustedRequestOrigin(sameOrigin), true);
  assert.equal(oidc.hasTrustedRequestOrigin(crossOrigin), false);
  assert.equal(
    oidc.hasTrustedRequestOrigin(
      new Request("https://example.com/api/auth/kakao/session"),
    ),
    false,
  );
});
