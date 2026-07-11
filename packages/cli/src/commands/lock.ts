import { resolve } from "node:path";
import type { Command } from "commander";
import { lockDef } from "../mutate.ts";

const USAGE = "Usage: kumiki lock <file> <agent-id> <pattern>";

export function registerLock(program: Command): void {
  program
    .command("lock")
    .description("Lock a name / pattern to an owning agent")
    .argument("[file]", "target .kumiki file")
    .argument("[agent-id]", "agent id claiming the lock")
    .argument("[pattern]", "glob pattern of definitions to lock")
    .allowExcessArguments(false)
    .action(
      (file: string | undefined, agentId: string | undefined, pattern: string | undefined) => {
        if (!file || !agentId || !pattern) {
          console.error(USAGE);
          process.exit(2);
        }
        try {
          lockDef(resolve(process.cwd(), file), agentId, pattern);
          console.log(`locked ${pattern} for ${agentId}`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}
