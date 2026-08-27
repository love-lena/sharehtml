import Conf from "conf";
import { chmodSync } from "node:fs";

interface Config {
  workerUrl: string;
  authToken: string;
  authCredentials: Record<string, string>;
  documentMappings: Record<string, string>;
}

const config = new Conf<Config>({
  projectName: "sharehtml-cli",
  defaults: {
    workerUrl: "",
    authToken: "",
    authCredentials: {},
    documentMappings: {},
  },
});

export function getConfig(): Config {
  return {
    workerUrl: config.get("workerUrl"),
    authToken: config.get("authToken") || "",
    authCredentials: config.get("authCredentials") || {},
    documentMappings: config.get("documentMappings") || {},
  };
}

function protectConfigFile(): void {
  protectCredentialFile(config.path);
}

export function protectCredentialFile(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Conf will report any actual write failures. Permission hardening is best-effort
    // on filesystems that do not implement POSIX modes.
  }
}

export function setFallbackCredential(account: string, credential: string): void {
  config.set("authCredentials", { ...config.get("authCredentials"), [account]: credential });
  protectConfigFile();
}

export function clearStoredCredentials(account?: string): void {
  config.set("authToken", "");
  if (account) {
    const credentials = { ...config.get("authCredentials") };
    delete credentials[account];
    config.set("authCredentials", credentials);
  }
  protectConfigFile();
}

export function setConfig(key: keyof Config, value: string): void {
  config.set(key, value);
}

export function isConfigured(): boolean {
  const c = getConfig();
  return Boolean(c.workerUrl);
}

export function getDocumentMapping(filePath: string): string | undefined {
  return config.get("documentMappings")?.[filePath];
}

export function setDocumentMapping(filePath: string, documentId: string): void {
  const currentMappings = config.get("documentMappings") || {};
  config.set("documentMappings", {
    ...currentMappings,
    [filePath]: documentId,
  });
}

export function removeDocumentMapping(filePath: string): void {
  const currentMappings = { ...(config.get("documentMappings") || {}) };
  delete currentMappings[filePath];
  config.set("documentMappings", currentMappings);
}
