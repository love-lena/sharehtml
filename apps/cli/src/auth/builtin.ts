import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { saveCliCredential } from "./credentials.js";

function openSystemBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}

interface BuiltinLoginOptions {
  openBrowser?: (url: string) => void;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  saveCredential?: typeof saveCliCredential;
  timeoutMs?: number;
}

export async function loginWithBuiltin(workerUrl: string, options: BuiltinLoginOptions = {}): Promise<string> {
  const launchBrowser = options.openBrowser || openSystemBrowser;
  const request = options.fetch || fetch;
  const saveCredential = options.saveCredential || saveCliCredential;
  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  let finish: ((code: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== "/callback") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found.");
      return;
    }
    const returnedState = url.searchParams.get("state") || "";
    const expectedState = Buffer.from(state);
    const actualState = Buffer.from(returnedState);
    if (expectedState.length !== actualState.length || !timingSafeEqual(expectedState, actualState)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Login state did not match. Return to the terminal and try again.");
      fail?.(new Error("Login state did not match"));
      return;
    }
    const callbackError = url.searchParams.get("error");
    if (callbackError) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Login was not completed. Return to the terminal and try again.");
      fail?.(new Error(callbackError));
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Missing login code.");
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>sharehtml login complete</title><p>Login complete. You can close this window.</p>");
    finish?.(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the local login callback");
  }
  const callback = `http://127.0.0.1:${address.port}/callback`;
  const params = new URLSearchParams({
    redirect_uri: callback,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const loginUrl = `${workerUrl}/auth/cli?${params}`;
  console.log(`Open this URL to log in:\n${loginUrl}`);
  launchBrowser(loginUrl);

  const timeout = setTimeout(() => fail?.(new Error("Login timed out after 5 minutes")), options.timeoutMs ?? 5 * 60_000);
  try {
    const code = await codePromise;
    const response = await request(`${workerUrl}/auth/cli/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: callback, code_verifier: codeVerifier }),
    });
    const result = await response.json() as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      email?: string;
      error?: string;
    };
    if (
      !response.ok ||
      !result.access_token ||
      result.token_type !== "Bearer" ||
      result.expires_in !== 86_400
    ) throw new Error(result.error || "Could not finish login");
    await saveCredential(workerUrl, {
      accessToken: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
      email: result.email || "signed-in user",
    });
    return result.email || "signed-in user";
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}
