import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { decodeJwt, SignJWT } from "jose";
import { auth } from "../src/routes/auth.js";
import {
  authMiddleware,
  CLI_TOKEN_LIFETIME_SECONDS,
  createBuiltinToken,
  createCliToken,
  SESSION_COOKIE,
  verifyBuiltinToken,
  verifyCliToken,
} from "../src/utils/auth.js";
import { sha256 } from "../src/utils/crypto.js";
import { getRegistry } from "../src/utils/registry.js";
import type { AppBindings } from "../src/types.js";

describe("built-in authentication", () => {
  it("signs and verifies ShareHTML session tokens", async () => {
    const authEnv = { ...env, AUTH_SECRET: "test-secret" } as Env;
    const token = await createBuiltinToken(authEnv, {
      id: "github:123",
      email: "person@example.com",
      emails: ["person@example.com", "invited@example.org"],
      source: "github",
    }, "5m");

    await expect(verifyBuiltinToken(authEnv, token)).resolves.toMatchObject({
      id: "github:123",
      email: "person@example.com",
      emails: ["person@example.com", "invited@example.org"],
      source: "github",
    });
    await expect(verifyBuiltinToken({ ...authEnv, AUTH_SECRET: "wrong" } as Env, token)).resolves.toBeNull();
  });

  it("classifies a built-in browser session by its cookie transport", async () => {
    const authEnv = { ...env, AUTH_MODE: "builtin", AUTH_SECRET: "test-secret" } as Env;
    const token = await createBuiltinToken(authEnv, {
      id: "github:123",
      email: "person@example.com",
      source: "github",
    }, "5m");
    const app = new Hono<AppBindings>();
    app.use("/*", authMiddleware);
    app.get("/", (c) => c.json(c.get("authUser")));

    const response = await app.request("https://example.com/", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    }, authEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "github:123",
      email: "person@example.com",
      source: "cookie",
    });
  });

  it("signs dedicated 24-hour CLI tokens with verified email aliases", async () => {
    const authEnv = { ...env, AUTH_SECRET: "test-secret" } as Env;
    const token = await createCliToken(authEnv, {
      id: "github:123",
      email: "person@example.com",
      emails: ["person@example.com", "work@example.org"],
    });
    const payload = decodeJwt(token);

    expect(payload.aud).toBe("sharehtml-cli");
    expect(payload.token_use).toBe("cli");
    expect((payload.exp || 0) - (payload.iat || 0)).toBe(CLI_TOKEN_LIFETIME_SECONDS);
    await expect(verifyCliToken(authEnv, token)).resolves.toMatchObject({
      id: "github:123",
      email: "person@example.com",
      emails: ["person@example.com", "work@example.org"],
      source: "bearer",
    });
    await expect(verifyBuiltinToken(authEnv, token)).resolves.toBeNull();
  });

  it("rejects browser and legacy tokens used as bearer credentials", async () => {
    const authEnv = { ...env, AUTH_MODE: "builtin", AUTH_SECRET: "test-secret" } as Env;
    const browserToken = await createBuiltinToken(authEnv, {
      id: "github:123",
      email: "person@example.com",
      source: "github",
    });
    const legacyToken = await new SignJWT({ email: "person@example.com", source: "email" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("email:person@example.com")
      .setIssuer("sharehtml")
      .setAudience("sharehtml")
      .setIssuedAt()
      .setExpirationTime("90d")
      .sign(new TextEncoder().encode("test-secret"));
    const app = new Hono<AppBindings>();
    app.use("/*", authMiddleware);
    app.get("/", (c) => c.json(c.get("authUser")));

    for (const token of [browserToken, legacyToken]) {
      const response = await app.request("https://example.com/", {
        headers: { Authorization: `Bearer ${token}` },
      }, authEnv);
      expect(response.status).toBe(401);
    }
  });

  it("rejects CLI tokens used as browser cookies", async () => {
    const authEnv = { ...env, AUTH_MODE: "builtin", AUTH_SECRET: "test-secret" } as Env;
    const token = await createCliToken(authEnv, { id: "github:123", email: "person@example.com" });
    const app = new Hono<AppBindings>();
    app.use("/*", authMiddleware);
    app.get("/", (c) => c.json(c.get("authUser")));
    const response = await app.request("https://example.com/", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    }, authEnv);
    expect(response.status).toBe(401);
  });

  it("requires existing GitHub sessions to refresh their verified email aliases", async () => {
    const authEnv = { ...env, AUTH_SECRET: "test-secret" } as Env;
    const oldToken = await new SignJWT({ email: "person@example.com", source: "github" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("github:123")
      .setIssuer("sharehtml")
      .setAudience("sharehtml")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("test-secret"));

    await expect(verifyBuiltinToken(authEnv, oldToken)).resolves.toBeNull();
  });

  it("makes email codes single-use and limits rapid resends", async () => {
    const registry = getRegistry(env);
    const email = `auth-${crypto.randomUUID()}@example.com`;
    const now = Date.now();

    await expect(registry.issueEmailLoginCode(email, "hash-1", now, now + 60_000)).resolves.toEqual({ ok: true, retryAfter: 0 });
    const resend = await registry.issueEmailLoginCode(email, "hash-2", now + 1_000, now + 61_000);
    expect(resend.ok).toBe(false);
    expect(resend.retryAfter).toBeGreaterThan(0);
    await expect(registry.verifyEmailLoginCode(email, "hash-1", now + 2_000)).resolves.toBe(true);
    await expect(registry.verifyEmailLoginCode(email, "hash-1", now + 3_000)).resolves.toBe(false);
  });

  it("exchanges each CLI login code only once", async () => {
    const registry = getRegistry(env);
    const codeHash = `cli-${crypto.randomUUID()}`;
    const now = Date.now();
    await registry.createCliLoginCode(
      codeHash,
      { id: "github:123", email: "cli@example.com", emails: ["work@example.org"] },
      "http://127.0.0.1:12345/callback",
      "challenge",
      now + 60_000,
    );
    await expect(registry.consumeCliLoginCode(codeHash, now)).resolves.toMatchObject({
      user: { id: "github:123", email: "cli@example.com", emails: ["work@example.org"] },
      redirectUri: "http://127.0.0.1:12345/callback",
      codeChallenge: "challenge",
    });
    await expect(registry.consumeCliLoginCode(codeHash, now)).resolves.toBeNull();
  });

  it("requires PKCE and binds the CLI exchange to its callback", async () => {
    const authEnv = { ...env, AUTH_MODE: "builtin", AUTH_SECRET: "test-secret" } as Env;
    const verifier = "v".repeat(43);
    const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const state = "s".repeat(43);
    const redirectUri = "http://127.0.0.1:45678/callback";
    const session = await createBuiltinToken(authEnv, {
      id: "github:321",
      email: "person@example.com",
      emails: ["person@example.com", "work@example.org"],
      source: "github",
    });
    const query = new URLSearchParams({
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const missingState = await auth.request(`https://example.com/cli?${new URLSearchParams({
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    })}`, {}, authEnv);
    expect(missingState.status).toBe(400);

    const authorize = await auth.request(`https://example.com/cli?${query}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    expect(authorize.status).toBe(302);
    const completeUrl = new URL(authorize.headers.get("location")!, "https://example.com");
    completeUrl.pathname = completeUrl.pathname.replace(/^\/auth/, "");
    const complete = await auth.request(completeUrl.toString(), {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    expect(complete.status).toBe(302);
    const callback = new URL(complete.headers.get("location")!, redirectUri);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe(state);
    const code = callback.searchParams.get("code")!;

    const changedRedirect = await auth.request("https://example.com/cli/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: "http://127.0.0.1:45679/callback", code_verifier: verifier }),
    }, authEnv);
    expect(changedRedirect.status).toBe(400);

    // A failed proof burns the authorization code.
    const reused = await auth.request("https://example.com/cli/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri, code_verifier: verifier }),
    }, authEnv);
    expect(reused.status).toBe(400);

    const wrongAuthorize = await auth.request(`https://example.com/cli?${query}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    const wrongCompleteUrl = new URL(wrongAuthorize.headers.get("location")!, "https://example.com");
    wrongCompleteUrl.pathname = wrongCompleteUrl.pathname.replace(/^\/auth/, "");
    const wrongComplete = await auth.request(wrongCompleteUrl.toString(), {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    const wrongCode = new URL(wrongComplete.headers.get("location")!, redirectUri).searchParams.get("code")!;
    const wrongVerifier = await auth.request("https://example.com/cli/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: wrongCode, redirect_uri: redirectUri, code_verifier: "x".repeat(43) }),
    }, authEnv);
    expect(wrongVerifier.status).toBe(400);

    const authorizeAgain = await auth.request(`https://example.com/cli?${query}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    const completeAgainUrl = new URL(authorizeAgain.headers.get("location")!, "https://example.com");
    completeAgainUrl.pathname = completeAgainUrl.pathname.replace(/^\/auth/, "");
    const completeAgain = await auth.request(completeAgainUrl.toString(), {
      headers: { Cookie: `${SESSION_COOKIE}=${session}` },
    }, authEnv);
    expect(completeAgain.status).toBe(302);
    const validCode = new URL(completeAgain.headers.get("location")!, redirectUri).searchParams.get("code")!;
    const exchange = await auth.request("https://example.com/cli/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: validCode, redirect_uri: redirectUri, code_verifier: verifier }),
    }, authEnv);
    expect(exchange.status).toBe(200);
    const result = await exchange.json<{ access_token: string; token_type: string; expires_in: number }>();
    expect(result.token_type).toBe("Bearer");
    expect(result.expires_in).toBe(86_400);
    expect(exchange.headers.get("Cache-Control")).toBe("no-store");
    await expect(verifyCliToken(authEnv, result.access_token)).resolves.toMatchObject({
      id: "github:321",
      emails: ["person@example.com", "work@example.org"],
    });
  });

  it("expires CLI authorization codes after 60 seconds", async () => {
    const authEnv = { ...env, AUTH_MODE: "builtin", AUTH_SECRET: "test-secret" } as Env;
    const code = crypto.randomUUID();
    const verifier = "z".repeat(43);
    const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await getRegistry(env).createCliLoginCode(
      await sha256(`test-secret:cli:${code}`),
      { id: "github:999", email: "expired@example.com" },
      "http://127.0.0.1:34567/callback",
      challenge,
      Date.now() - 1,
    );
    const response = await auth.request("https://example.com/cli/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        redirect_uri: "http://127.0.0.1:34567/callback",
        code_verifier: verifier,
      }),
    }, authEnv);
    expect(response.status).toBe(400);
  });
});
