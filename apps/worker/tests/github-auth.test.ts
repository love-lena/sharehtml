import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "../src/routes/auth.js";
import { authMiddleware, SESSION_COOKIE } from "../src/utils/auth.js";
import type { AppBindings } from "../src/types.js";

const registry = vi.hoisted(() => ({ setUser: vi.fn() }));
vi.mock("../src/utils/registry.js", () => ({ getRegistry: () => registry }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function testApp() {
  const app = new Hono<AppBindings>();
  app.route("/auth", auth);
  app.use("/protected", authMiddleware);
  app.get("/protected", (c) => c.json(c.get("authUser")));
  return app;
}

const authEnv = {
  ...env,
  AUTH_MODE: "builtin",
  AUTH_SECRET: "test-session-secret",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
} as Env;

describe("GitHub browser login", () => {
  it.each(["https://artifacts.example.com", "http://localhost:8787"])(
    "exchanges the code and creates a usable session at %s",
    async (origin) => {
      const app = testApp();
      const start = await app.request(`${origin}/auth/github?next=%2Fprotected`, {}, authEnv);
      expect(start.status).toBe(302);
      const authorize = new URL(start.headers.get("location")!);
      const cookies = start.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
      const verifier = cookies.find((cookie) => cookie.startsWith("sharehtml_oauth_pkce="))!.split("=")[1];
      const callback = `${origin}/auth/github/callback`;
      expect(authorize.searchParams.get("redirect_uri")).toBe(callback);
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(authorize.searchParams.get("code_challenge")).toBe(challenge);

      const email = `github-${crypto.randomUUID()}@example.com`;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === "https://github.com/login/oauth/access_token") {
          expect(init?.method).toBe("POST");
          expect(Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams))).toEqual({
            client_id: "test-client-id",
            client_secret: "test-client-secret",
            code: "test-authorization-code",
            code_verifier: verifier,
            redirect_uri: callback,
          });
          return Response.json({ access_token: "test-github-token" });
        }
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-github-token");
        if (url === "https://api.github.com/user") {
          return Response.json({ id: 123, login: "test-user" });
        }
        if (url === "https://api.github.com/user/emails") {
          return Response.json([{ email, primary: true, verified: true }]);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      });

      const params = new URLSearchParams({
        code: "test-authorization-code",
        state: authorize.searchParams.get("state")!,
      });
      const complete = await app.request(`${callback}?${params}`, {
        headers: { Cookie: cookies.join("; ") },
      }, authEnv);
      expect(complete.status).toBe(302);
      expect(complete.headers.get("location")).toBe("/protected");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(registry.setUser).toHaveBeenCalledWith(email, "test-user");
      const session = complete.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))!;
      expect(session).toContain("HttpOnly");
      expect(session).toContain("SameSite=Lax");
      if (origin.startsWith("https:")) expect(session).toContain("Secure");

      const protectedPage = await app.request(`${origin}/protected`, {
        headers: { Cookie: session.split(";")[0], Accept: "text/html" },
      }, authEnv);
      expect(protectedPage.status).toBe(200);
      await expect(protectedPage.json()).resolves.toMatchObject({ id: "github:123", email, source: "cookie" });
    },
  );

  it("rejects a mismatched OAuth state before exchanging the code", async () => {
    const app = testApp();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected token exchange"));
    const response = await app.request("https://example.com/auth/github/callback?state=wrong&code=test-code", {
      headers: { Cookie: "sharehtml_oauth_state=expected; sharehtml_oauth_pkce=test-verifier" },
    }, authEnv);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });
});
