import { resolve } from "node:path";
import type { Command } from "commander";
import { describeEdit, renameDef } from "../mutate.ts";
import { WARN_SKIPPED } from "./_shared/op-log.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki rename <file> <qname> <new-name>";

export function registerRename(program: Command): string {
  program
    .command("rename")
    .description("Rename a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .argument("[new-name]", "new bare name")
    .allowExcessArguments(false)
    .action((file: string | undefined, qname: string | undefined, newName: string | undefined) => {
      if (!file || !qname || !newName) exitWithUsage(USAGE);
      printOrExit(() => {
        const opId = renameDef(resolve(process.cwd(), file), qname, newName, WARN_SKIPPED);
        return describeEdit({ op: "rename", qname, newName, opId });
      });
    });
  return USAGE;
}
