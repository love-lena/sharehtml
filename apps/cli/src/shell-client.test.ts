import { describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function executable(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o755 });
  chmodSync(path, 0o755);
}

describe("repository shell client", () => {
  it("completes device login, stores a protected session, and sends bearer API requests", () => {
    const root = mkdtempSync(join(tmpdir(), "sharehtml-shell-"));
    const fakeBin = join(root, "bin");
    const configHome = join(root, "config");
    mkdirSync(fakeBin);
    try {
      executable(join(fakeBin, "uname"), "#!/bin/sh\necho Linux\n");
      executable(join(fakeBin, "open"), "#!/bin/sh\nexit 0\n");
      executable(join(fakeBin, "sleep"), "#!/bin/sh\nexit 0\n");
      executable(join(fakeBin, "curl"), `#!/bin/sh
request_url=""
for argument in "$@"; do case "$argument" in https://*) request_url="$argument" ;; esac; done
case "$request_url" in
  https://example.com/auth/cli/device/token) echo '{"access_token":"test-cli-token","token_type":"Bearer","expires_in":86400,"email":"person@example.com"}' ;;
  https://example.com/auth/cli/device) echo '{"device_code":"device-code","user_code":"ABCDEFGH","verification_uri_complete":"https://example.com/auth/cli/device/verify?user_code=ABCDEFGH","expires_in":600,"interval":3}' ;;
  https://example.com/api/documents)
    case "$*" in *"Authorization: Bearer test-cli-token"*) echo '{"documents":[]}' ;; *) exit 22 ;; esac ;;
  *) exit 22 ;;
esac
`);
      const script = resolve(import.meta.dir, "../../../bin/sharehtml");
      const env = {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        HOME: root,
        XDG_CONFIG_HOME: configHome,
        SHAREHTML_URL: "https://example.com",
      };
      const login = Bun.spawnSync([script, "login"], { env, stdout: "pipe", stderr: "pipe" });
      expect(login.exitCode).toBe(0);
      expect(login.stdout.toString()).toContain("Login complete (person@example.com)");

      const credentialPath = join(configHome, "sharehtml", "credentials");
      expect(statSync(credentialPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(credentialPath, "utf8")).toContain("test-cli-token");

      const list = Bun.spawnSync([script, "list"], { env, stdout: "pipe", stderr: "pipe" });
      expect(list.exitCode).toBe(0);
      expect(list.stdout.toString()).toContain('{"documents":[]}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
