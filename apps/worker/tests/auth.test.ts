import { env } from "cloudflare:workers";
import { createBuiltinToken, verifyBuiltinToken } from "../src/utils/auth.js";
import { getRegistry } from "../src/utils/registry.js";

describe("built-in authentication", () => {
  it("signs and verifies ShareHTML session tokens", async () => {
    const authEnv = { ...env, AUTH_SECRET: "test-secret" } as Env;
    const token = await createBuiltinToken(authEnv, {
      id: "github:123",
      email: "person@example.com",
      source: "github",
    }, "5m");

    await expect(verifyBuiltinToken(authEnv, token)).resolves.toMatchObject({
      id: "github:123",
      email: "person@example.com",
      source: "github",
    });
    await expect(verifyBuiltinToken({ ...authEnv, AUTH_SECRET: "wrong" } as Env, token)).resolves.toBeNull();
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
    await registry.createCliLoginCode(codeHash, "cli@example.com", now + 60_000);
    await expect(registry.consumeCliLoginCode(codeHash, now)).resolves.toBe("cli@example.com");
    await expect(registry.consumeCliLoginCode(codeHash, now)).resolves.toBeNull();
  });
});
