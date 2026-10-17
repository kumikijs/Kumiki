import type { Command } from "commander";
import { describeEdit, renameDef } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
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
      const path = sourceFileArg(file);
      printOrExit(() => {
        const opId = renameDef(path, qname, newName);
        return describeEdit({ op: "rename", qname, newName, opId });
      });
    });
  return USAGE;
}
