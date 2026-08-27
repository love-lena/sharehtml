import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { loginWithBuiltin } from "./builtin.js";
import { isCliCredentialExpired, type CliCredential } from "./credentials.js";

describe("built-in CLI login", () => {
  it("uses state and S256 PKCE before saving a 24-hour credential", async () => {
    const saved: CliCredential[] = [];
    let loginUrl: URL | null = null;
    const result = await loginWithBuiltin("https://example.com", {
      openBrowser(url) {
        loginUrl = new URL(url);
        const callback = new URL(loginUrl.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "one-time-code");
        callback.searchParams.set("state", loginUrl.searchParams.get("state")!);
        void fetch(callback);
      },
      async fetch(url, init) {
        expect(String(url)).toBe("https://example.com/auth/cli/token");
        const body = JSON.parse(String(init?.body)) as {
          code: string;
          redirect_uri: string;
          code_verifier: string;
        };
        expect(body.code).toBe("one-time-code");
        expect(body.redirect_uri).toBe(loginUrl!.searchParams.get("redirect_uri")!);
        expect(createHash("sha256").update(body.code_verifier).digest("base64url"))
          .toBe(loginUrl!.searchParams.get("code_challenge")!);
        expect(loginUrl!.searchParams.get("code_challenge_method")!).toBe("S256");
        return Response.json({
          access_token: "cli-token",
          token_type: "Bearer",
          expires_in: 86_400,
          email: "person@example.com",
        });
      },
      async saveCredential(_workerUrl, credential) {
        saved.push(credential);
      },
      timeoutMs: 1_000,
    });

    expect(result).toBe("person@example.com");
    expect(saved[0]?.accessToken).toBe("cli-token");
    expect(saved[0]?.expiresAt).toBeGreaterThan(Date.now() + 86_300_000);
  });

  it("rejects callbacks whose state does not match", async () => {
    await expect(loginWithBuiltin("https://example.com", {
      openBrowser(url) {
        const loginUrl = new URL(url);
        const callback = new URL(loginUrl.searchParams.get("redirect_uri")!);
        callback.searchParams.set("code", "attacker-code");
        callback.searchParams.set("state", "wrong-state");
        void fetch(callback);
      },
      timeoutMs: 1_000,
    })).rejects.toThrow("Login state did not match");
  });

  it("times out when no valid callback arrives", async () => {
    await expect(loginWithBuiltin("https://example.com", {
      openBrowser() {},
      timeoutMs: 10,
    })).rejects.toThrow("Login timed out after 5 minutes");
  });

  it("treats credentials within 30 seconds of expiry as expired", () => {
    const credential = { accessToken: "token", email: "person@example.com", expiresAt: 130_000 };
    expect(isCliCredentialExpired(credential, 100_000)).toBe(true);
    expect(isCliCredentialExpired({ ...credential, expiresAt: 130_001 }, 100_000)).toBe(false);
  });
});
