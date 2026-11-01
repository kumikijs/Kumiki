import { resolve } from "node:path";
import type { Command } from "commander";
import { lockDef, lockPatternProblem } from "../mutate.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki lock <file> <agent-id> <pattern>";

export function registerLock(program: Command): string {
  program
    .command("lock")
    .description("Lock a name / pattern to an owning agent")
    .argument("[file]", "target .kumiki file")
    .argument("[agent-id]", "agent id claiming the lock")
    .argument("[pattern]", "glob pattern of definitions to lock")
    .allowExcessArguments(false)
    .action(
      (file: string | undefined, agentId: string | undefined, pattern: string | undefined) => {
        if (!file || !agentId || !pattern) exitWithUsage(USAGE);
        const problem = lockPatternProblem(pattern);
        if (problem !== undefined) {
          console.error(problem);
          exitWithUsage(USAGE);
        }
        printOrExit(() => {
          lockDef(resolve(process.cwd(), file), agentId, pattern);
          return `locked ${pattern} for ${agentId}`;
        });
      },
    );
  return USAGE;
}
