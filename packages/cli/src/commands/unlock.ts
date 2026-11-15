import type { Command } from "commander";
import { unlockDef } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki unlock <file> <agent-id>";

export function registerUnlock(program: Command): string {
  program
    .command("unlock")
    .description("Release all locks owned by <agent-id>")
    .argument("[file]", "target .kumiki file")
    .argument("[agent-id]", "agent id whose locks to release")
    .allowExcessArguments(false)
    .action((file: string | undefined, agentId: string | undefined) => {
      if (!file || !agentId) exitWithUsage(USAGE);
      const path = sourceFileArg(file);
      printOrExit(() => {
        unlockDef(path, agentId);
        return `unlocked ${agentId}`;
      });
    });
  return USAGE;
}
