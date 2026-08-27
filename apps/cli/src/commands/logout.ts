import { Command } from "commander";
import { deleteCliCredential } from "../auth/credentials.js";
import { getConfig, isConfigured } from "../config/store.js";

export const logoutCmd = new Command("logout")
  .description("Remove the saved CLI login for this ShareHTML deployment")
  .action(async () => {
    try {
      if (!isConfigured()) throw new Error("Not configured. Run: sharehtml config set-url <url>");
      const { workerUrl } = getConfig();
      await deleteCliCredential(workerUrl);
      console.log(`Logged out of ${new URL(workerUrl).origin}.`);
    } catch (error) {
      console.error(`Error: ${(error as Error).message}`);
      process.exit(1);
    }
  });
