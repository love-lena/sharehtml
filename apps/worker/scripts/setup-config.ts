import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";

export type DeploymentTarget =
  | { kind: "workers-dev" }
  | { kind: "custom-domain"; hostname: string };

export interface SetupConfig {
  name: string;
  bucketName: string;
  customHostname: string | null;
}

const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeCustomHostname(value: string): string | null {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  if (hostname.length > 253 || !hostname.includes(".")) return null;
  if (hostname.includes(":") || hostname.includes("/") || hostname.includes("*")) return null;

  const labels = hostname.split(".");
  if (labels.some((label) =>
    label.length === 0 ||
    label.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) return null;

  return hostname;
}

export function readSetupConfig(source: string): SetupConfig {
  const errors: ParseError[] = [];
  const config: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isRecord(config)) {
    throw new Error("Could not parse wrangler.jsonc");
  }

  const env = isRecord(config.env) ? config.env : {};
  const production = isRecord(env.production) ? env.production : {};
  const name = typeof production.name === "string" ? production.name : config.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Could not find the production Worker name in wrangler.jsonc");
  }

  const buckets = Array.isArray(production.r2_buckets) ? production.r2_buckets : [];
  const bucket = buckets.find((entry: unknown) =>
    isRecord(entry) && entry.binding === "DOCUMENTS_BUCKET"
  ) as Record<string, unknown> | undefined;
  if (!bucket || typeof bucket.bucket_name !== "string") {
    throw new Error("Could not find the production DOCUMENTS_BUCKET binding in wrangler.jsonc");
  }

  const routes = Array.isArray(production.routes) ? production.routes : [];
  const customRoute = routes.find((entry: unknown) =>
    isRecord(entry) &&
    entry.custom_domain === true &&
    typeof entry.pattern === "string"
  ) as Record<string, unknown> | undefined;

  return {
    name,
    bucketName: bucket.bucket_name,
    customHostname: typeof customRoute?.pattern === "string" ? customRoute.pattern : null,
  };
}

export function updateProductionConfiguration(
  source: string,
  vars: Record<string, string>,
  target: DeploymentTarget,
): string {
  let updated = source;
  const setValue = (path: (string | number)[], value: unknown) => {
    updated = applyEdits(updated, modify(updated, path, value, { formattingOptions }));
  };

  for (const [key, value] of Object.entries(vars)) {
    setValue(["env", "production", "vars", key], value);
  }

  if (target.kind === "custom-domain") {
    setValue(["env", "production", "workers_dev"], false);
    setValue(["env", "production", "routes"], [
      { pattern: target.hostname, custom_domain: true },
    ]);
  } else {
    setValue(["env", "production", "workers_dev"], true);
    setValue(["env", "production", "routes"], undefined);
  }

  return updated;
}

export function removeProductionSecretRequirements(source: string): string {
  return applyEdits(
    source,
    modify(source, ["env", "production", "secrets"], undefined, { formattingOptions }),
  );
}
