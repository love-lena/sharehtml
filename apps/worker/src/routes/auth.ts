import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppBindings } from "../types.js";
import { LoginView, VerifyEmailView } from "../frontend/auth.js";
import { createBuiltinToken, getBuiltinUser, SESSION_COOKIE } from "../utils/auth.js";
import { normalizeEmail } from "../utils/email.js";
import { sha256 } from "../utils/crypto.js";
import { getRegistry } from "../utils/registry.js";

export const auth = new Hono<AppBindings>();
const OAUTH_STATE_COOKIE = "sharehtml_oauth_state";
const OAUTH_NEXT_COOKIE = "sharehtml_oauth_next";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeNext(value: string | undefined | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function randomToken(bytes = 24): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secure(c: { req: { url: string } }): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function githubEnabled(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim());
}

function emailEnabled(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.AUTH_EMAIL_FROM?.trim());
}

async function authHash(env: Env, kind: string, value: string): Promise<string> {
  if (!env.AUTH_SECRET) throw new Error("AUTH_SECRET is not configured");
  return sha256(`${env.AUTH_SECRET}:${kind}:${value}`);
}

async function setSession(c: Context<AppBindings>, user: { id: string; email: string; emails?: string[]; source: "github" | "email" }) {
  const token = await createBuiltinToken(c.env, user);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

function loginPage(c: Context<AppBindings>, options?: { error?: string; message?: string }) {
  const next = safeNext(c.req.query("next"));
  return c.html(LoginView({
    next,
    githubEnabled: githubEnabled(c.env),
    emailEnabled: emailEnabled(c.env),
    ...options,
  }));
}

function validCliRedirect(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    return url;
  } catch {
    return null;
  }
}

auth.get("/methods", (c) => c.json({
  mode: c.env.AUTH_MODE,
  github: c.env.AUTH_MODE === "builtin" && githubEnabled(c.env),
  email: c.env.AUTH_MODE === "builtin" && emailEnabled(c.env),
}));

auth.get("/login", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.redirect("/");
  if (await getBuiltinUser(c)) return c.redirect(safeNext(c.req.query("next")));
  return loginPage(c);
});

auth.get("/github", (c) => {
  if (c.env.AUTH_MODE !== "builtin" || !githubEnabled(c.env)) return loginPage(c, { error: "GitHub login is not configured." });
  const state = randomToken();
  const next = safeNext(c.req.query("next"));
  const cookieOptions = { httpOnly: true, secure: secure(c), sameSite: "Lax" as const, path: "/auth", maxAge: 600 };
  setCookie(c, OAUTH_STATE_COOKIE, state, cookieOptions);
  setCookie(c, OAUTH_NEXT_COOKIE, next, cookieOptions);
  const callback = `${new URL(c.req.url).origin}/auth/github/callback`;
  const params = new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID!, redirect_uri: callback, scope: "read:user user:email", state });
  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

auth.get("/github/callback", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.redirect("/");
  const state = c.req.query("state");
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
  const next = safeNext(getCookie(c, OAUTH_NEXT_COOKIE));
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/auth" });
  deleteCookie(c, OAUTH_NEXT_COOKIE, { path: "/auth" });
  if (!state || !expectedState || state !== expectedState || !githubEnabled(c.env)) {
    return c.html(LoginView({ next, githubEnabled: githubEnabled(c.env), emailEnabled: emailEnabled(c.env), error: "GitHub login could not be verified. Please try again." }), 400);
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID!, client_secret: c.env.GITHUB_CLIENT_SECRET!, code: c.req.query("code") || "" }),
  });
  const tokenData = await tokenResponse.json<{ access_token?: string }>();
  if (!tokenData.access_token) return loginPage(c, { error: "GitHub did not complete the login." });
  const headers = { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "sharehtml" };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch("https://api.github.com/user", { headers }),
    fetch("https://api.github.com/user/emails", { headers }),
  ]);
  const user = await userResponse.json<{ id?: number; login?: string; name?: string; email?: string | null }>();
  const emails = emailsResponse.ok ? await emailsResponse.json<Array<{ email: string; primary: boolean; verified: boolean }>>() : [];
  const verifiedEmails = [...new Set(emails.filter((entry) => entry.verified).map((entry) => normalizeEmail(entry.email)).filter(Boolean))];
  const email = normalizeEmail(emails.find((entry) => entry.primary && entry.verified)?.email || verifiedEmails[0] || "");
  if (!user.id || !EMAIL_RE.test(email)) return loginPage(c, { error: "GitHub did not provide a verified email address." });
  await getRegistry(c.env).setUser(email, user.name || user.login || email.split("@")[0]);
  await setSession(c, { id: `github:${user.id}`, email, emails: verifiedEmails, source: "github" });
  return c.redirect(next);
});

auth.post("/email/request", async (c) => {
  if (c.env.AUTH_MODE !== "builtin" || !emailEnabled(c.env)) return c.json({ error: "Email login is not configured" }, 503);
  const contentType = c.req.header("Content-Type") || "";
  const body = contentType.includes("application/json") ? await c.req.json<{ email?: string; next?: string }>() : Object.fromEntries(await c.req.formData()) as { email?: string; next?: string };
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const next = safeNext(typeof body.next === "string" ? body.next : "/");
  if (!EMAIL_RE.test(email)) return c.html(VerifyEmailView({ email, next, error: "Enter a valid email address." }), 400);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const now = Date.now();
  const requestKey = await authHash(c.env, "request", c.req.header("CF-Connecting-IP") || "unknown");
  const result = await getRegistry(c.env).issueEmailLoginCode(
    email,
    await authHash(c.env, "email", `${email}:${code}`),
    now,
    now + 10 * 60_000,
    requestKey,
  );
  if (!result.ok) return c.json({ error: `Please wait ${result.retryAfter} seconds before requesting another code.` }, 429);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `login-${crypto.randomUUID()}`,
      "User-Agent": "sharehtml",
    },
    body: JSON.stringify({ from: c.env.AUTH_EMAIL_FROM, to: [email], subject: `${code} is your sharehtml code`, text: `Your sharehtml sign-in code is ${code}. It expires in 10 minutes.` }),
  });
  if (!response.ok) {
    console.error("Resend email failed", response.status, await response.text());
    return c.html(VerifyEmailView({ email, next, error: "We could not send the email. Please try again shortly." }), 502);
  }
  if (contentType.includes("application/json")) return c.json({ ok: true });
  return c.html(VerifyEmailView({ email, next }));
});

auth.post("/email/verify", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.json({ error: "Built-in authentication is disabled" }, 404);
  const contentType = c.req.header("Content-Type") || "";
  const body = contentType.includes("application/json") ? await c.req.json<{ email?: string; code?: string; next?: string }>() : Object.fromEntries(await c.req.formData()) as { email?: string; code?: string; next?: string };
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const next = safeNext(typeof body.next === "string" ? body.next : "/");
  const valid = /^\d{6}$/.test(code) && await getRegistry(c.env).verifyEmailLoginCode(email, await authHash(c.env, "email", `${email}:${code}`), Date.now());
  if (!valid) return c.html(VerifyEmailView({ email, next, error: "That code is invalid or expired." }), 400);
  const registry = getRegistry(c.env);
  if (!(await registry.getUser(email))) {
    await registry.setUser(email, email.split("@")[0]);
  }
  await setSession(c, { id: `email:${email}`, email, source: "email" });
  if (contentType.includes("application/json")) return c.json({ ok: true });
  return c.redirect(next);
});

auth.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/auth/login");
});

auth.get("/cli", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.text("Built-in authentication is disabled", 404);
  const redirect = validCliRedirect(c.req.query("redirect_uri") || "");
  if (!redirect) return c.text("Invalid CLI callback URL", 400);
  const next = `/auth/cli/complete?redirect_uri=${encodeURIComponent(redirect.toString())}`;
  if (!(await getBuiltinUser(c))) return c.redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  return c.redirect(next);
});

auth.get("/cli/complete", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.text("Built-in authentication is disabled", 404);
  const user = await getBuiltinUser(c);
  const redirect = validCliRedirect(c.req.query("redirect_uri") || "");
  if (!redirect) return c.text("Invalid CLI callback URL", 400);
  if (!user) return c.redirect(`/auth/login?next=${encodeURIComponent(`${c.req.path}?redirect_uri=${encodeURIComponent(redirect.toString())}`)}`);
  const code = randomToken(32);
  await getRegistry(c.env).createCliLoginCode(await authHash(c.env, "cli", code), user.email, Date.now() + 5 * 60_000);
  redirect.searchParams.set("code", code);
  return c.redirect(redirect.toString());
});

auth.post("/cli/token", async (c) => {
  if (c.env.AUTH_MODE !== "builtin") return c.json({ error: "Built-in authentication is disabled" }, 404);
  const { code } = await c.req.json<{ code?: string }>();
  if (!code) return c.json({ error: "Missing code" }, 400);
  const email = await getRegistry(c.env).consumeCliLoginCode(await authHash(c.env, "cli", code), Date.now());
  if (!email) return c.json({ error: "Invalid or expired code" }, 400);
  const token = await createBuiltinToken(c.env, { id: `email:${email}`, email, source: "email" }, "90d");
  return c.json({ token, email });
});
