import type { Command } from "commander";
import { CASCADE_HELP, describeEdit, removeDef } from "../mutate.ts";
import { sourceFileArg } from "./_shared/source-file.ts";
import { exitWithUsage, printOrExit } from "./_shared/usage.ts";

const USAGE = "Usage: kumiki remove <file> <qname> [--cascade]";

export function registerRemove(program: Command): string {
  program
    .command("remove")
    .description("Remove a definition")
    .argument("[file]", "target .kumiki file")
    .argument("[qname]", "qualified name")
    .option("--cascade", CASCADE_HELP)
    .allowExcessArguments(false)
    .action(
      (file: string | undefined, qname: string | undefined, options: { cascade?: boolean }) => {
        if (!file || !qname) exitWithUsage(USAGE);
        const path = sourceFileArg(file);
        printOrExit(() => {
          const result = removeDef(path, qname, Boolean(options.cascade));
          return describeEdit({ op: "remove", qname, ...result });
        });
      },
    );
  return USAGE;
}
