import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { Context } from "hono";
import type { AppBindings } from "../types.js";
import { normalizeEmail } from "./email.js";

export const SESSION_COOKIE = "sharehtml_session";

export interface AuthUser {
  id: string;
  email: string;
  emails?: string[];
  source: AuthSource;
}

export type AuthSource = "access-jwt-header" | "cf-access-token" | "cookie" | "bearer" | "github" | "email" | "dev";

let jwksCache: { teamName: string; jwks: ReturnType<typeof createRemoteJWKSet> } | null = null;
const encoder = new TextEncoder();

function getJWKS(teamName: string) {
  if (!jwksCache || jwksCache.teamName !== teamName) {
    jwksCache = {
      teamName,
      jwks: createRemoteJWKSet(new URL(`https://${teamName}.cloudflareaccess.com/cdn-cgi/access/certs`)),
    };
  }
  return jwksCache.jwks;
}

function getAccessJWT(c: Context): { jwt: string | null; source: AuthSource | null } {
  const accessJwtHeader = c.req.header("CF-Access-JWT-Assertion");
  if (accessJwtHeader) return { jwt: accessJwtHeader, source: "access-jwt-header" };
  const accessTokenHeader = c.req.header("cf-access-token");
  if (accessTokenHeader) return { jwt: accessTokenHeader, source: "cf-access-token" };
  const accessCookie = getCookie(c, "CF_Authorization");
  if (accessCookie) return { jwt: accessCookie, source: "cookie" };
  return { jwt: null, source: null };
}

async function verifyAccessJWT(jwt: string, env: Env): Promise<AuthUser | null> {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM) return null;
  try {
    const { payload } = await jwtVerify(jwt, getJWKS(env.ACCESS_TEAM), {
      audience: env.ACCESS_AUD,
      issuer: `https://${env.ACCESS_TEAM}.cloudflareaccess.com`,
    });
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!payload.sub || !email) return null;
    return { id: payload.sub, email, source: "cookie" };
  } catch (error) {
    console.error("JWT verification failed", error instanceof Error ? error.message : String(error));
    return null;
  }
}

function getAuthSecret(env: Env): Uint8Array {
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is required when AUTH_MODE=builtin");
  return encoder.encode(secret);
}

export async function createBuiltinToken(
  env: Env,
  user: Pick<AuthUser, "id" | "email" | "source" | "emails">,
  expiresIn = "30d",
): Promise<string> {
  return new SignJWT({ email: user.email, emails: getAuthEmails(user), source: user.source })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer("sharehtml")
    .setAudience("sharehtml")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getAuthSecret(env));
}

export async function verifyBuiltinToken(env: Env, token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getAuthSecret(env), {
      algorithms: ["HS256"],
      issuer: "sharehtml",
      audience: "sharehtml",
    });
    if (!payload.sub || typeof payload.email !== "string") return null;
    if (payload.source === "github" && !Array.isArray(payload.emails)) return null;
    const source: AuthSource = payload.source === "github" ? "github" : "email";
    const emails = Array.isArray(payload.emails)
      ? payload.emails.filter((email): email is string => typeof email === "string")
      : [];
    return { id: payload.sub, email: normalizeEmail(payload.email), emails: getAuthEmails({ email: payload.email, emails }), source };
  } catch {
    return null;
  }
}

export async function getBuiltinUser(c: Context<AppBindings>): Promise<AuthUser | null> {
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const user = await verifyBuiltinToken(c.env, authorization.slice(7));
    return user ? { ...user, source: "bearer" } : null;
  }
  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return null;
  const user = await verifyBuiltinToken(c.env, cookie);
  return user ? { ...user, source: "cookie" } : null;
}

function unauthorized(c: Context<AppBindings>) {
  const acceptsHtml = c.req.method === "GET" && (c.req.header("Accept") || "").includes("text/html");
  if (acceptsHtml) {
    const url = new URL(c.req.url);
    return c.redirect(`/auth/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  return c.json({ error: "Authentication required" }, 401);
}

export const authMiddleware = createMiddleware<AppBindings>(async (c, next) => {
  if (c.env.AUTH_MODE === "none") {
    c.set("authUser", { id: "dev", email: "dev@localhost", source: "dev" });
    return next();
  }
  if (c.env.AUTH_MODE === "builtin") {
    const user = await getBuiltinUser(c);
    if (!user) return unauthorized(c);
    c.set("authUser", user);
    return next();
  }
  const { jwt, source } = getAccessJWT(c);
  if (!jwt || !source) return unauthorized(c);
  const user = await verifyAccessJWT(jwt, c.env);
  if (!user) return unauthorized(c);
  c.set("authUser", { ...user, source });
  return next();
});

export function getAuthEmails(user: Pick<AuthUser, "email" | "emails">): string[] {
  return [...new Set([user.email, ...(user.emails || [])].map(normalizeEmail).filter(Boolean))];
}

export function authUserHasEmail(user: Pick<AuthUser, "email" | "emails">, email: string): boolean {
  return getAuthEmails(user).includes(normalizeEmail(email));
}
