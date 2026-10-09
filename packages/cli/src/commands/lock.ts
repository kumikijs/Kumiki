import type { Command } from "commander";
import { lockDef, lockPatternProblem } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";

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
        // Decided from the pattern alone, before the file is read, so it is the
        // arguments' shape that is wrong (§9.2.5).
        const problem = lockPatternProblem(pattern);
        if (problem !== undefined) {
          console.error(problem);
          console.error(USAGE);
          process.exit(2);
        }
        const path = sourceFileArg(file);
        try {
          lockDef(path, agentId, pattern);
          console.log(`locked ${pattern} for ${agentId}`);
        } catch (e) {
          console.error(String(e));
          process.exit(1);
        }
      },
    );
}
