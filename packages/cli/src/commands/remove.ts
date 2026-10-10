import { resolve } from "node:path";
import type { Command } from "commander";
import { CASCADE_HELP, describeEdit, removeDef } from "../mutate.ts";
import { WARN_SKIPPED } from "./_shared/op-log.ts";
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
        printOrExit(() => {
          const result = removeDef(
            resolve(process.cwd(), file),
            qname,
            Boolean(options.cascade),
            WARN_SKIPPED,
          );
          return describeEdit({ op: "remove", qname, ...result });
        });
      },
    );
  return USAGE;
}
