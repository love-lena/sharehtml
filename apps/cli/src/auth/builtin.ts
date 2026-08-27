import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { setAuthToken } from "../config/store.js";

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}

export async function loginWithBuiltin(workerUrl: string): Promise<string> {
  let finish: ((code: string) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const codePromise = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
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
  const loginUrl = `${workerUrl}/auth/cli?redirect_uri=${encodeURIComponent(callback)}`;
  console.log(`Opening ${loginUrl}`);
  openBrowser(loginUrl);

  const timeout = setTimeout(() => fail?.(new Error("Login timed out after 5 minutes")), 5 * 60_000);
  try {
    const code = await codePromise;
    const response = await fetch(`${workerUrl}/auth/cli/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const result = await response.json() as { token?: string; email?: string; error?: string };
    if (!response.ok || !result.token) throw new Error(result.error || "Could not finish login");
    setAuthToken(result.token);
    return result.email || "signed-in user";
  } finally {
    clearTimeout(timeout);
    server.close();
  }
}
