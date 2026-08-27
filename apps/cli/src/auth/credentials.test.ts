import { describe, expect, it } from "bun:test";
import { createCredentialStore, type CliCredential, type CredentialStoreDependencies } from "./credentials.js";

function mockStore(now = 1_000) {
  const platform = new Map<string, string>();
  const fallback = new Map<string, string>();
  const deleted: string[] = [];
  let platformWritable = true;
  let legacyToken = false;
  const dependencies: CredentialStoreDependencies = {
    async readPlatform(account) { return platform.get(account) || null; },
    async writePlatform(account, value) {
      if (!platformWritable) return false;
      platform.set(account, value);
      return true;
    },
    async deletePlatform(account) { platform.delete(account); deleted.push(account); },
    readFallback(account) { return fallback.get(account); },
    writeFallback(account, value) { fallback.set(account, value); },
    clearFallback(account) { fallback.delete(account); legacyToken = false; },
    hasLegacyToken() { return legacyToken; },
    now() { return now; },
  };
  return {
    store: createCredentialStore(dependencies),
    platform,
    fallback,
    deleted,
    disablePlatform() { platformWritable = false; },
    addLegacyToken() { legacyToken = true; },
  };
}

const credential: CliCredential = {
  accessToken: "token",
  email: "person@example.com",
  expiresAt: 100_000,
};

describe("CLI credential storage", () => {
  it("prefers platform storage and keys credentials by normalized origin", async () => {
    const mock = mockStore();
    await mock.store.save("https://EXAMPLE.com/path", credential);
    expect(mock.platform.has("https://example.com")).toBe(true);
    expect(mock.fallback.size).toBe(0);
    await expect(mock.store.load("https://example.com/other")).resolves.toEqual({ credential, expired: false });
  });

  it("uses fallback storage when the platform credential service is unavailable", async () => {
    const mock = mockStore();
    mock.disablePlatform();
    await mock.store.save("https://example.com", credential);
    expect(mock.fallback.has("https://example.com")).toBe(true);
    await expect(mock.store.load("https://example.com")).resolves.toEqual({ credential, expired: false });
  });

  it("removes expired and legacy credentials", async () => {
    const expired = mockStore(100_000);
    await expired.store.save("https://example.com", credential);
    await expect(expired.store.load("https://example.com")).resolves.toEqual({ credential: null, expired: true });
    expect(expired.deleted).toEqual(["https://example.com"]);

    const legacy = mockStore();
    legacy.addLegacyToken();
    await expect(legacy.store.load("https://example.com")).resolves.toEqual({ credential: null, expired: false });
  });

  it("deletes both platform and fallback credentials on logout", async () => {
    const mock = mockStore();
    await mock.store.save("https://example.com", credential);
    mock.fallback.set("https://example.com", JSON.stringify(credential));
    await mock.store.delete("https://example.com");
    expect(mock.platform.size).toBe(0);
    expect(mock.fallback.size).toBe(0);
  });
});
