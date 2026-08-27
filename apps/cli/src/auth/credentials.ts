import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { clearStoredCredentials, getConfig, setFallbackCredential } from "../config/store.js";

const execFileAsync = promisify(execFile);
const SERVICE = "dog.lena.sharehtml.cli";

export interface CliCredential {
  accessToken: string;
  expiresAt: number;
  email: string;
}

export function isCliCredentialExpired(credential: CliCredential, now = Date.now()): boolean {
  return credential.expiresAt <= now + 30_000;
}

function credentialAccount(workerUrl: string): string {
  return new URL(workerUrl).origin.toLowerCase();
}

function parseCredential(value: string): CliCredential | null {
  try {
    const parsed = JSON.parse(value) as Partial<CliCredential>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.email !== "string"
    ) return null;
    return parsed as CliCredential;
  } catch {
    return null;
  }
}

async function runWithInput(command: string, args: string[], input: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)));
    child.stdin.end(input);
  });
}

async function readPlatformCredential(account: string): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password", "-s", SERVICE, "-a", account, "-w",
      ], { encoding: "utf8" });
      return stdout.trim() || null;
    }
    if (process.platform === "linux") {
      const { stdout } = await execFileAsync("secret-tool", [
        "lookup", "service", SERVICE, "account", account,
      ], { encoding: "utf8" });
      return stdout.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function writePlatformCredential(account: string, value: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      await runWithInput("security", [
        "add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w",
      ], `${value}\n`);
      return true;
    }
    if (process.platform === "linux") {
      await runWithInput("secret-tool", [
        "store", `--label=ShareHTML CLI (${account})`, "service", SERVICE, "account", account,
      ], value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

async function deletePlatformCredential(account: string): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execFileAsync("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    } else if (process.platform === "linux") {
      await execFileAsync("secret-tool", ["clear", "service", SERVICE, "account", account]);
    }
  } catch {
    // Missing platform helpers and already-absent credentials are both harmless.
  }
}

export interface CredentialStoreDependencies {
  readPlatform(account: string): Promise<string | null>;
  writePlatform(account: string, value: string): Promise<boolean>;
  deletePlatform(account: string): Promise<void>;
  readFallback(account: string): string | undefined;
  writeFallback(account: string, value: string): void;
  clearFallback(account: string): void;
  hasLegacyToken(): boolean;
  now(): number;
}

export function createCredentialStore(dependencies: CredentialStoreDependencies) {
  return {
    async save(workerUrl: string, credential: CliCredential): Promise<void> {
      const account = credentialAccount(workerUrl);
      const serialized = JSON.stringify(credential);
      const storedInPlatform = await dependencies.writePlatform(account, serialized);
      dependencies.clearFallback(account);
      if (!storedInPlatform) dependencies.writeFallback(account, serialized);
    },

    async load(workerUrl: string): Promise<{ credential: CliCredential | null; expired: boolean }> {
      const account = credentialAccount(workerUrl);
      const serialized = await dependencies.readPlatform(account) || dependencies.readFallback(account);
      const credential = serialized ? parseCredential(serialized) : null;

      // Legacy 90-day bearer tokens are intentionally not migrated into the new session format.
      if (dependencies.hasLegacyToken()) dependencies.clearFallback(account);
      if (!credential) return { credential: null, expired: false };
      if (isCliCredentialExpired(credential, dependencies.now())) {
        await dependencies.deletePlatform(account);
        dependencies.clearFallback(account);
        return { credential: null, expired: true };
      }
      return { credential, expired: false };
    },

    async delete(workerUrl: string): Promise<void> {
      const account = credentialAccount(workerUrl);
      await dependencies.deletePlatform(account);
      dependencies.clearFallback(account);
    },
  };
}

const credentialStore = createCredentialStore({
  readPlatform: readPlatformCredential,
  writePlatform: writePlatformCredential,
  deletePlatform: deletePlatformCredential,
  readFallback: (account) => getConfig().authCredentials[account],
  writeFallback: setFallbackCredential,
  clearFallback: clearStoredCredentials,
  hasLegacyToken: () => Boolean(getConfig().authToken),
  now: Date.now,
});

export async function saveCliCredential(workerUrl: string, credential: CliCredential): Promise<void> {
  return credentialStore.save(workerUrl, credential);
}

export async function loadCliCredential(workerUrl: string): Promise<{ credential: CliCredential | null; expired: boolean }> {
  return credentialStore.load(workerUrl);
}

export async function deleteCliCredential(workerUrl: string): Promise<void> {
  return credentialStore.delete(workerUrl);
}
