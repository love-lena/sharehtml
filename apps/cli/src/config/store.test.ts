import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protectCredentialFile } from "./store.js";

describe("credential fallback permissions", () => {
  it("restricts the fallback config file to its owner", () => {
    const directory = mkdtempSync(join(tmpdir(), "sharehtml-config-"));
    const path = join(directory, "config.json");
    try {
      writeFileSync(path, "{}", { mode: 0o644 });
      chmodSync(path, 0o644);
      protectCredentialFile(path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
