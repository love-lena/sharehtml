import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  isMissingWorkerError,
  normalizeCustomHostname,
  readSetupConfig,
  removeProductionSecretRequirements,
  updateProductionConfiguration,
} from "./setup-config.js";

const config = `{
  // comments must survive setup edits
  "name": "sharehtml-dev",
  "env": {
    "production": {
      "name": "sharehtml",
      "workers_dev": true,
      "vars": {
        "AUTH_MODE": "access",
        "ACCESS_AUD": "",
        "ACCESS_TEAM": ""
      },
      "r2_buckets": [
        { "binding": "DOCUMENTS_BUCKET", "bucket_name": "sharehtml-documents" }
      ]
    }
  }
}`;

describe("custom hostname validation", () => {
  test("normalizes a valid hostname", () => {
    expect(normalizeCustomHostname(" Artifacts.Lena.Dog. ")).toBe("artifacts.lena.dog");
  });

  test("rejects URLs, paths, wildcards, and invalid labels", () => {
    expect(normalizeCustomHostname("https://artifacts.lena.dog")).toBeNull();
    expect(normalizeCustomHostname("artifacts.lena.dog/path")).toBeNull();
    expect(normalizeCustomHostname("*.lena.dog")).toBeNull();
    expect(normalizeCustomHostname("-artifacts.lena.dog")).toBeNull();
  });
});

describe("Wrangler setup configuration", () => {
  test("recognizes the live missing-Worker API response", () => {
    expect(isMissingWorkerError("This Worker does not exist on your account. [code: 10007]")).toBe(true);
  });

  test("reads the repository's JSONC config with trailing commas", () => {
    const repositoryConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(readSetupConfig(repositoryConfig)).toEqual({
      name: "sharehtml",
      bucketName: "sharehtml-documents",
      customHostname: "artifacts.lena.dog",
      authMode: "access",
      accessAud: expect.any(String),
      accessTeam: expect.any(String),
    });
  });

  test("reads the Worker, bucket, and current target", () => {
    expect(readSetupConfig(config)).toEqual({
      name: "sharehtml",
      bucketName: "sharehtml-documents",
      customHostname: null,
      authMode: "access",
      accessAud: "",
      accessTeam: "",
    });
  });

  test("can bootstrap a Worker without weakening the saved config", () => {
    const withRequiredSecret = config.replace(
      '"r2_buckets": [',
      '"secrets": { "required": ["VIEWER_CAPABILITY_SECRET"] },\n      "r2_buckets": [',
    );
    const bootstrapConfig = removeProductionSecretRequirements(withRequiredSecret);

    expect(bootstrapConfig).not.toContain("VIEWER_CAPABILITY_SECRET");
    expect(withRequiredSecret).toContain("VIEWER_CAPABILITY_SECRET");
  });

  test("writes a custom domain and disables workers.dev", () => {
    const updated = updateProductionConfiguration(
      config,
      { AUTH_MODE: "access", ACCESS_AUD: "aud-1", ACCESS_TEAM: "team-1" },
      { kind: "custom-domain", hostname: "artifacts.lena.dog" },
    );
    const parsed = JSON.parse(updated.replace(/\/\/.*$/gm, ""));

    expect(updated).toContain("comments must survive setup edits");
    expect(parsed.env.production.workers_dev).toBe(false);
    expect(parsed.env.production.routes).toEqual([
      { pattern: "artifacts.lena.dog", custom_domain: true },
    ]);
    expect(parsed.env.production.vars.ACCESS_AUD).toBe("aud-1");
  });

  test("can switch back to workers.dev without leaving a custom route", () => {
    const custom = updateProductionConfiguration(
      config,
      {},
      { kind: "custom-domain", hostname: "artifacts.lena.dog" },
    );
    const updated = updateProductionConfiguration(custom, {}, { kind: "workers-dev" });
    const parsed = JSON.parse(updated.replace(/\/\/.*$/gm, ""));

    expect(parsed.env.production.workers_dev).toBe(true);
    expect(parsed.env.production.routes).toBeUndefined();
  });
});
