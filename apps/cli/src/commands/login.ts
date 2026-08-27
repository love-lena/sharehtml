import { Command } from "commander";
import { loginWithAccess } from "../auth/access.js";
import { loginWithBuiltin } from "../auth/builtin.js";
import { printSetupHint } from "../config/help.js";
import { getConfig, isConfigured } from "../config/store.js";

export const loginCmd = new Command("login")
  .description("Log in for authenticated CLI requests")
  .action(async () => {
    try {
      if (!isConfigured()) {
        console.error("Error: Not configured. Run: sharehtml config set-url <url>");
        printSetupHint();
        process.exit(1);
      }

      const { workerUrl } = getConfig();
      console.log(`Logging in to ${workerUrl}...`);
      const response = await fetch(`${workerUrl}/auth/methods`);
      const methods = response.ok ? await response.json() as { mode?: string } : {};
      if (methods.mode === "builtin") {
        const email = await loginWithBuiltin(workerUrl);
        console.log(`Login complete (${email}).`);
      } else if (methods.mode === "none") {
        console.log("This deployment does not require login.");
      } else {
        await loginWithAccess(workerUrl);
        console.log("Login complete.");
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });
