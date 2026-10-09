import type { Command } from "commander";
import { unlockDef } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";

const USAGE = "Usage: kumiki unlock <file> <agent-id>";

export function registerUnlock(program: Command): void {
  program
    .command("unlock")
    .description("Release all locks owned by <agent-id>")
    .argument("[file]", "target .kumiki file")
    .argument("[agent-id]", "agent id whose locks to release")
    .allowExcessArguments(false)
    .action((file: string | undefined, agentId: string | undefined) => {
      if (!file || !agentId) {
        console.error(USAGE);
        process.exit(2);
      }
      const path = sourceFileArg(file);
      try {
        unlockDef(path, agentId);
        console.log(`unlocked ${agentId}`);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    });
}
